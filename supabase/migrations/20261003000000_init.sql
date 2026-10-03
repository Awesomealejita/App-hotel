-- =====================================================================
-- Hotel PMS + Housekeeping — esquema inicial
-- Supabase (Postgres 15+) · Auth · Realtime · Storage · RLS
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.user_role as enum ('manager', 'cleaner');

create type public.room_status as enum (
  'clean',          -- limpia, lista para entrar
  'dirty',          -- sucia (tras salida)
  'cleaning',       -- en limpieza ahora mismo
  'inspected',      -- limpia y revisada por responsable
  'out_of_service'  -- bloqueada (avería, obras…)
);

create type public.reservation_status as enum (
  'pending', 'confirmed', 'rejected', 'cancelled', 'checked_in', 'checked_out'
);

create type public.work_order_type as enum (
  'checkout_clean', 'stayover', 'deep_clean', 'maintenance', 'inspection'
);

create type public.work_order_status as enum (
  'pending', 'in_progress', 'done', 'verified', 'issue'
);

create type public.priority as enum ('low', 'normal', 'high', 'urgent');

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        public.user_role not null default 'cleaner',
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrar/invitar un usuario.
-- El rol se lee de raw_user_meta_data.role (solo lo puede fijar el
-- service role vía la función invite-user o el dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'cleaner')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_manager()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager' and active
  );
$$;

-- ---------------------------------------------------------------------
-- Habitaciones
-- ---------------------------------------------------------------------
create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  number      text not null unique,
  name        text,
  room_type   text not null default 'Doble',
  floor       int not null default 1,
  capacity    int not null default 2,
  status      public.room_status not null default 'clean',
  ical_token  text not null default encode(gen_random_bytes(16), 'hex'), -- para exportar iCal
  notes       text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Canales externos (Booking, Airbnb, Expedia…) y feeds iCal por habitación
-- ---------------------------------------------------------------------
create table public.booking_sources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  color         text not null default '#64748b',
  auto_confirm  boolean not null default false, -- si true, entra como confirmada
  created_at    timestamptz not null default now()
);

create table public.ical_feeds (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  source_id       uuid not null references public.booking_sources (id) on delete cascade,
  url             text not null,
  active          boolean not null default true,
  last_synced_at  timestamptz,
  last_error      text,
  unique (room_id, source_id)
);

-- ---------------------------------------------------------------------
-- Reservas
-- ---------------------------------------------------------------------
create table public.reservations (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid references public.rooms (id) on delete set null,
  source_id      uuid references public.booking_sources (id) on delete set null,
  external_uid   text,
  guest_name     text not null default 'Huésped',
  guest_email    text,
  guest_phone    text,
  guests         int not null default 2,
  check_in       date not null,
  check_out      date not null,
  status         public.reservation_status not null default 'pending',
  total_amount   numeric(10, 2),
  notes          text,
  decided_by     uuid references public.profiles (id),
  decided_at     timestamptz,
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint reservations_dates_ok check (check_out > check_in),
  constraint reservations_external_unique unique (source_id, external_uid),
  -- Impide overbooking: dos reservas activas no pueden solaparse en la misma habitación
  constraint reservations_no_overlap exclude using gist (
    room_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('confirmed', 'checked_in'))
);

create index reservations_dates_idx on public.reservations (check_in, check_out);
create index reservations_status_idx on public.reservations (status);

-- ---------------------------------------------------------------------
-- Plantillas de checklist
-- ---------------------------------------------------------------------
create table public.checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  order_type  public.work_order_type not null default 'checkout_clean',
  items       jsonb not null default '[]'::jsonb, -- [{ "key": "bed", "label": "Cambiar sábanas" }]
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Órdenes de trabajo (limpieza / mantenimiento)
-- ---------------------------------------------------------------------
create table public.work_orders (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms (id) on delete cascade,
  assigned_to     uuid references public.profiles (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  reservation_id  uuid references public.reservations (id) on delete set null,
  order_type      public.work_order_type not null default 'checkout_clean',
  priority        public.priority not null default 'normal',
  scheduled_date  date not null default current_date,
  status          public.work_order_status not null default 'pending',
  instructions    text,
  -- checklist: [{ "key": "bed", "label": "Cambiar sábanas", "done": false }]
  checklist       jsonb not null default '[]'::jsonb,
  rating          int check (rating between 1 and 5), -- estado en que se encontró la habitación
  started_at      timestamptz,
  completed_at    timestamptz,
  verified_by     uuid references public.profiles (id),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index work_orders_assignee_date_idx on public.work_orders (assigned_to, scheduled_date);
create index work_orders_date_idx on public.work_orders (scheduled_date);

-- Observaciones / incidencias de las limpiadoras (hilo por orden)
create table public.work_order_notes (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  author_id      uuid references public.profiles (id) on delete set null,
  body           text not null,
  is_issue       boolean not null default false, -- incidencia (avería, falta algo, daño…)
  photo_path     text,                           -- ruta en storage bucket "work-order-photos"
  created_at     timestamptz not null default now()
);

create index work_order_notes_order_idx on public.work_order_notes (work_order_id, created_at);

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rooms_touch before update on public.rooms
  for each row execute function public.touch_updated_at();
create trigger reservations_touch before update on public.reservations
  for each row execute function public.touch_updated_at();
create trigger work_orders_touch before update on public.work_orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Lógica de negocio de órdenes: tiempos y estado de habitación
-- ---------------------------------------------------------------------
create or replace function public.work_order_lifecycle()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then
      new.started_at := now();
    elsif new.status = 'done' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif new.status = 'verified' then
      new.verified_at := now();
      new.verified_by := auth.uid();
    end if;
  end if;

  -- Reflejar en la habitación
  if new.order_type in ('checkout_clean', 'stayover', 'deep_clean') then
    update public.rooms set status = case new.status
        when 'in_progress' then 'cleaning'::public.room_status
        when 'done'        then 'clean'::public.room_status
        when 'verified'    then 'inspected'::public.room_status
        else status
      end
    where id = new.room_id and status <> 'out_of_service';
  end if;
  if new.status = 'issue' then
    update public.rooms set status = 'out_of_service' where id = new.room_id
      and new.order_type = 'maintenance';
  end if;
  return new;
end;
$$;

create trigger work_orders_lifecycle
  before insert or update on public.work_orders
  for each row execute function public.work_order_lifecycle();

-- Al hacer check-out, la habitación pasa a "sucia"
create or replace function public.reservation_checkout_marks_dirty()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'checked_out' and old.status is distinct from 'checked_out' and new.room_id is not null then
    update public.rooms set status = 'dirty' where id = new.room_id and status <> 'out_of_service';
  end if;
  return new;
end;
$$;

create trigger reservations_checkout_dirty
  after update on public.reservations
  for each row execute function public.reservation_checkout_marks_dirty();

-- Las limpiadoras solo pueden tocar el progreso de SUS órdenes, no reasignarlas
create or replace function public.guard_cleaner_work_order_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if public.is_manager() then
    return new;
  end if;
  if new.room_id is distinct from old.room_id
     or new.assigned_to is distinct from old.assigned_to
     or new.order_type is distinct from old.order_type
     or new.scheduled_date is distinct from old.scheduled_date
     or new.priority is distinct from old.priority
     or new.instructions is distinct from old.instructions
     or new.status = 'verified' then
    raise exception 'Solo un responsable puede modificar esos campos';
  end if;
  return new;
end;
$$;

create trigger work_orders_guard_cleaner
  before update on public.work_orders
  for each row execute function public.guard_cleaner_work_order_update();

-- ---------------------------------------------------------------------
-- Funciones RPC
-- ---------------------------------------------------------------------

-- Habitaciones libres en un rango [p_from, p_to)
create or replace function public.available_rooms(p_from date, p_to date, p_exclude_reservation uuid default null)
returns setof public.rooms
language sql stable
as $$
  select r.*
  from public.rooms r
  where r.active
    and r.status <> 'out_of_service'
    and not exists (
      select 1 from public.reservations x
      where x.room_id = r.id
        and x.status in ('confirmed', 'checked_in')
        and (p_exclude_reservation is null or x.id <> p_exclude_reservation)
        and daterange(x.check_in, x.check_out, '[)') && daterange(p_from, p_to, '[)')
    )
  order by r.number;
$$;

-- Aceptar / rechazar una reserva pendiente (con control de disponibilidad)
create or replace function public.decide_reservation(p_id uuid, p_accept boolean, p_room_id uuid default null)
returns public.reservations
language plpgsql
security definer set search_path = public
as $$
declare
  res public.reservations;
begin
  if not public.is_manager() then
    raise exception 'Solo responsables';
  end if;

  select * into res from public.reservations where id = p_id for update;
  if not found then raise exception 'Reserva no encontrada'; end if;

  if p_accept then
    if coalesce(p_room_id, res.room_id) is null then
      raise exception 'Asigna una habitación antes de aceptar';
    end if;
    if not exists (
      select 1 from public.available_rooms(res.check_in, res.check_out, res.id)
      where id = coalesce(p_room_id, res.room_id)
    ) then
      raise exception 'La habitación no está disponible en esas fechas';
    end if;
    update public.reservations
       set status = 'confirmed', room_id = coalesce(p_room_id, room_id),
           decided_by = auth.uid(), decided_at = now()
     where id = p_id returning * into res;
  else
    update public.reservations
       set status = 'rejected', decided_by = auth.uid(), decided_at = now()
     where id = p_id returning * into res;
  end if;
  return res;
end;
$$;

-- Genera órdenes de limpieza para las salidas de un día (idempotente)
create or replace function public.generate_checkout_orders(p_date date default current_date)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  n int;
  tpl jsonb;
begin
  if not public.is_manager() then
    raise exception 'Solo responsables';
  end if;

  select coalesce(jsonb_agg(item || jsonb_build_object('done', false)), '[]'::jsonb)
    into tpl
    from jsonb_array_elements((
      select items from public.checklist_templates
      where order_type = 'checkout_clean'
      order by created_at
      limit 1
    )) as item;

  insert into public.work_orders (room_id, reservation_id, order_type, scheduled_date, checklist, created_by, priority)
  select r.room_id, r.id, 'checkout_clean', p_date, tpl, auth.uid(),
         case when exists (
           select 1 from public.reservations n
           where n.room_id = r.room_id and n.check_in = p_date and n.status = 'confirmed'
         ) then 'high'::public.priority else 'normal'::public.priority end
  from public.reservations r
  where r.check_out = p_date
    and r.room_id is not null
    and r.status in ('confirmed', 'checked_in', 'checked_out')
    and not exists (
      select 1 from public.work_orders w
      where w.reservation_id = r.id and w.order_type = 'checkout_clean'
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- KPIs agregados para el dashboard
create or replace function public.dashboard_stats(p_from date, p_to date)
returns jsonb
language plpgsql stable
security definer set search_path = public
as $$
declare
  total_rooms int;
  days int := greatest(p_to - p_from, 1);
  result jsonb;
begin
  if not public.is_manager() then
    raise exception 'Solo responsables';
  end if;

  select count(*) into total_rooms from public.rooms where active;

  with nights as (
    select d::date as day, count(r.id) as occupied
    from generate_series(p_from, p_to - 1, interval '1 day') d
    left join public.reservations r
      on r.status in ('confirmed', 'checked_in', 'checked_out')
     and d::date >= r.check_in and d::date < r.check_out
    group by d
  ),
  wo as (
    select * from public.work_orders where scheduled_date >= p_from and scheduled_date < p_to
  )
  select jsonb_build_object(
    'total_rooms', total_rooms,
    'room_nights_sold', (select coalesce(sum(occupied), 0) from nights),
    'occupancy_pct', round(100.0 * (select coalesce(sum(occupied), 0) from nights) / nullif(total_rooms * days, 0), 1),
    'revenue', (
      select coalesce(sum(total_amount), 0) from public.reservations
      where status in ('confirmed', 'checked_in', 'checked_out') and check_in >= p_from and check_in < p_to
    ),
    'reservations_by_status', (
      select coalesce(jsonb_object_agg(status, c), '{}'::jsonb) from (
        select status, count(*) c from public.reservations
        where created_at >= p_from and created_at < p_to + 1 group by status
      ) s
    ),
    'reservations_by_source', (
      select coalesce(jsonb_agg(jsonb_build_object('source', coalesce(b.name, 'Directo'), 'color', coalesce(b.color, '#0ea5e9'), 'count', c)), '[]'::jsonb)
      from (
        select source_id, count(*) c from public.reservations
        where status in ('confirmed', 'checked_in', 'checked_out') and check_in >= p_from and check_in < p_to
        group by source_id
      ) s left join public.booking_sources b on b.id = s.source_id
    ),
    'occupancy_series', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'occupied', occupied) order by day), '[]'::jsonb) from nights
    ),
    'orders_total', (select count(*) from wo),
    'orders_done', (select count(*) from wo where status in ('done', 'verified')),
    'orders_issue', (select count(*) from wo where status = 'issue'),
    'avg_clean_minutes', (
      select round(avg(extract(epoch from completed_at - started_at) / 60)::numeric, 1)
      from wo where started_at is not null and completed_at is not null
    ),
    'avg_room_rating', (select round(avg(rating)::numeric, 2) from wo where rating is not null),
    'by_cleaner', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.done desc), '[]'::jsonb) from (
        select p.full_name as name,
               count(*) filter (where w.status in ('done', 'verified')) as done,
               count(*) as total,
               round(avg(extract(epoch from w.completed_at - w.started_at) / 60)::numeric, 1) as avg_minutes,
               (select count(*) from public.work_order_notes n join wo w2 on w2.id = n.work_order_id
                 where n.author_id = p.id) as notes
        from wo w join public.profiles p on p.id = w.assigned_to
        group by p.id, p.full_name
      ) t
    ),
    'issues_by_room', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.issues desc), '[]'::jsonb) from (
        select r.number as room, count(*) as issues
        from public.work_order_notes n
        join wo w on w.id = n.work_order_id
        join public.rooms r on r.id = w.room_id
        where n.is_issue
        group by r.number
      ) t
    )
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.rooms               enable row level security;
alter table public.booking_sources     enable row level security;
alter table public.ical_feeds          enable row level security;
alter table public.reservations        enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.work_orders         enable row level security;
alter table public.work_order_notes    enable row level security;

-- profiles
create policy "profiles: read authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles: managers manage" on public.profiles
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- rooms: todos leen, responsables escriben
create policy "rooms: read" on public.rooms for select to authenticated using (true);
create policy "rooms: managers write" on public.rooms
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- canales / feeds / plantillas / reservas: solo responsables (plantillas legibles por todos)
create policy "sources: read" on public.booking_sources for select to authenticated using (true);
create policy "sources: managers write" on public.booking_sources
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "feeds: managers" on public.ical_feeds
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "reservations: managers" on public.reservations
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "templates: read" on public.checklist_templates for select to authenticated using (true);
create policy "templates: managers write" on public.checklist_templates
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- work_orders
create policy "orders: managers all" on public.work_orders
  for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "orders: cleaner reads own" on public.work_orders
  for select to authenticated using (assigned_to = auth.uid());
create policy "orders: cleaner updates own" on public.work_orders
  for update to authenticated using (assigned_to = auth.uid()) with check (assigned_to = auth.uid());

-- work_order_notes
create policy "notes: managers all" on public.work_order_notes
  for all to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "notes: cleaner reads own orders" on public.work_order_notes
  for select to authenticated using (
    exists (select 1 from public.work_orders w where w.id = work_order_id and w.assigned_to = auth.uid())
  );
create policy "notes: cleaner writes on own orders" on public.work_order_notes
  for insert to authenticated with check (
    author_id = auth.uid()
    and exists (select 1 from public.work_orders w where w.id = work_order_id and w.assigned_to = auth.uid())
  );

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.rooms, public.reservations, public.work_orders, public.work_order_notes;

-- ---------------------------------------------------------------------
-- Storage: fotos de incidencias
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('work-order-photos', 'work-order-photos', false)
on conflict (id) do nothing;

-- Convención de ruta: <user_id>/<work_order_id>/<archivo>
create policy "photos: upload own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'work-order-photos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "photos: read own or manager" on storage.objects
  for select to authenticated using (
    bucket_id = 'work-order-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_manager())
  );
