-- =====================================================================
-- Formulario público de solicitud de reserva (huéspedes sin cuenta)
-- =====================================================================

alter table public.rooms add column if not exists base_price numeric(10, 2) not null default 80;

alter table public.reservations
  add column if not exists requested_room_type text,
  add column if not exists reference text unique;

insert into public.booking_sources (name, color, auto_confirm)
values ('Web del hotel', '#7c3aed', false)
on conflict (name) do nothing;

-- Disponibilidad pública: solo tipos de habitación, plazas y precio.
-- Nunca expone reservas ni datos de huéspedes.
create or replace function public.public_availability(p_from date, p_to date, p_guests int default 1)
returns table (room_type text, capacity int, available int, price_per_night numeric)
language plpgsql stable
security definer set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'La fecha de salida debe ser posterior a la de entrada';
  end if;
  if p_from < current_date then
    raise exception 'La fecha de entrada no puede ser anterior a hoy';
  end if;
  if p_to - p_from > 30 then
    raise exception 'Para estancias de más de 30 noches contacta con el hotel';
  end if;

  return query
    select r.room_type, max(r.capacity)::int, count(*)::int, min(r.base_price)
    from public.available_rooms(p_from, p_to) r
    where r.capacity >= greatest(p_guests, 1)
    group by r.room_type
    order by min(r.base_price);
end;
$$;

-- Crea una solicitud de reserva pendiente. Devuelve la referencia para el huésped.
create or replace function public.request_booking(
  p_check_in date,
  p_check_out date,
  p_guests int,
  p_room_type text,
  p_name text,
  p_email text,
  p_phone text default null,
  p_notes text default null,
  p_website text default null -- campo trampa anti-bots: las personas lo dejan vacío
)
returns text
language plpgsql volatile
security definer set search_path = public
as $$
declare
  v_source uuid;
  v_price numeric;
  v_ref text;
begin
  v_ref := 'WEB-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
  if coalesce(p_website, '') <> '' then
    return v_ref; -- bot: respuesta normal, pero no se guarda nada
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 or length(p_name) > 100 then
    raise exception 'Indica tu nombre';
  end if;
  if coalesce(p_email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then
    raise exception 'El email no es válido';
  end if;
  if length(coalesce(p_phone, '')) > 30 or length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Texto demasiado largo';
  end if;
  if p_guests is null or p_guests < 1 or p_guests > 8 then
    raise exception 'Número de huéspedes no válido';
  end if;

  select a.price_per_night into v_price
  from public.public_availability(p_check_in, p_check_out, p_guests) a
  where a.room_type = p_room_type;
  if not found then
    raise exception 'Ya no queda disponibilidad para ese tipo de habitación en esas fechas';
  end if;

  select id into v_source from public.booking_sources where name = 'Web del hotel';

  -- Límite sencillo contra abusos: 3 solicitudes por email y hora
  if (select count(*) from public.reservations
      where source_id = v_source and lower(guest_email) = lower(p_email)
        and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Has enviado varias solicitudes seguidas. Inténtalo más tarde o llama al hotel';
  end if;

  insert into public.reservations (
    source_id, external_uid, reference, guest_name, guest_email, guest_phone, guests,
    check_in, check_out, status, requested_room_type, total_amount, notes
  ) values (
    v_source, v_ref, v_ref, trim(p_name), lower(trim(p_email)), nullif(trim(p_phone), ''), p_guests,
    p_check_in, p_check_out, 'pending', p_room_type, v_price * (p_check_out - p_check_in), nullif(trim(p_notes), '')
  );
  return v_ref;
end;
$$;

grant execute on function public.public_availability(date, date, int) to anon, authenticated;
grant execute on function public.request_booking(date, date, int, text, text, text, text, text, text) to anon, authenticated;
