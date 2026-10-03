# App Hotel · PMS + Housekeeping

App web/móvil para un hotel de 15 habitaciones:

- **Calendario unificado** con las reservas de Booking.com, Airbnb, Expedia… (sincronización iCal) y las directas.
- **Aceptar / rechazar reservas** viendo la disponibilidad real, el estado de limpieza de la habitación y el último feedback de la limpiadora. Una restricción de base de datos impide el overbooking.
- **Órdenes de trabajo** para las limpiadoras (manuales o generadas automáticamente a partir de las salidas del día), con checklist por tipo de limpieza.
- **App móvil para limpiadoras** (PWA instalable): ven sus tareas de hoy/mañana, marcan el checklist, valoran cómo encontraron la habitación, escriben observaciones, reportan incidencias con foto.
- **Tiempo real**: los responsables reciben al instante cada avance, observación e incidencia; las limpiadoras reciben al instante las nuevas órdenes.
- **Dashboard** semanal / mensual / anual: ocupación, noches vendidas, ingresos, reservas por canal, rendimiento por limpiadora (hechas, minutos medios, observaciones), incidencias por habitación y valoración media.
- **Login con roles**: `manager` (responsable) y `cleaner` (limpieza). Seguridad aplicada en la base de datos con Row Level Security.

## Arquitectura (100 % gratuita para empezar)

| Pieza | Tecnología | Plan gratuito |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS, PWA | Vercel / Netlify / Cloudflare Pages |
| Base de datos | Supabase Postgres (RLS, triggers, funciones RPC) | Supabase Free (500 MB) |
| Login | Supabase Auth (email + contraseña) | incluido |
| Tiempo real | Supabase Realtime (cambios de Postgres) | incluido |
| Fotos de incidencias | Supabase Storage (bucket privado) | 1 GB |
| Sincronización de canales | Supabase Edge Functions (Deno) + pg_cron | 500 k invocaciones/mes |

> **¿Y LangGraph?** No hace falta para la gestión del día a día: Supabase cubre datos, login y tiempo real. LangGraph tendría sentido más adelante para un *agente de IA* (p. ej. resumir automáticamente las observaciones de limpieza de la semana, proponer asignaciones o responder a huéspedes). Ver *Siguientes pasos*.

```
 Booking / Airbnb / Expedia ──iCal──▶ Edge Function sync-ical ──▶ reservations
            ▲                                                         │
            └──── iCal export (ical-export) ◀── confirmadas ──────────┤
                                                                       ▼
 Responsables (escritorio) ◀──── Realtime ────▶ Postgres + RLS ◀──── Limpiadoras (móvil)
```

### Estructura

```
supabase/
  migrations/20261003000000_init.sql   # tablas, enums, RLS, triggers, RPC, realtime, storage
  migrations/20261003000100_cron_sync.sql  # (opcional) sincronización cada 15 min
  seed.sql                             # 15 habitaciones, canales, plantillas de checklist
  functions/sync-ical/                 # importa reservas de los canales
  functions/ical-export/               # exporta disponibilidad a los canales (anti-overbooking)
  functions/invite-user/               # alta de personal por un responsable
src/
  pages/manager/   Dashboard, Calendario, Reservas, Habitaciones, Órdenes, Ajustes
  pages/cleaner/   Mis tareas, Detalle de orden (checklist + observaciones)
```

### Modelo de datos

- `rooms` — estado de housekeeping: `clean`, `dirty`, `cleaning`, `inspected`, `out_of_service`.
- `reservations` — `pending → confirmed → checked_in → checked_out` (o `rejected` / `cancelled`). Restricción `EXCLUDE` que impide solapar reservas confirmadas en la misma habitación.
- `booking_sources` + `ical_feeds` — canales y enlaces iCal por habitación. `auto_confirm` decide si entran confirmadas o pendientes.
- `work_orders` — orden por habitación y día, con checklist (JSON), prioridad, tiempos, valoración 1-5.
- `work_order_notes` — observaciones / incidencias (con foto opcional).
- `checklist_templates` — plantillas editables por tipo de orden.

Automatismos en base de datos:

- Empezar una orden → habitación *Limpiando*; terminarla → *Limpia*; verificarla → *Revisada*.
- Check-out de una reserva → habitación *Sucia*.
- `generate_checkout_orders(fecha)` crea las órdenes de limpieza de las salidas del día (prioridad alta si hay entrada ese mismo día).
- Las limpiadoras solo ven y modifican **sus** órdenes, y no pueden reasignarlas ni verificarlas.

## Puesta en marcha

### 1. Supabase

1. Crea un proyecto gratis en <https://supabase.com>.
2. Instala la CLI (`npm i -g supabase`) y enlaza el proyecto:
   ```bash
   supabase login
   supabase link --project-ref <tu-project-ref>
   supabase db push                      # aplica las migraciones
   psql "$(supabase db url)" -f supabase/seed.sql   # o pégalo en el SQL Editor
   ```
   *Sin CLI*: copia el contenido de `supabase/migrations/20261003000000_init.sql` y luego `supabase/seed.sql` en **SQL Editor** y ejecútalos.
3. Despliega las Edge Functions:
   ```bash
   supabase functions deploy sync-ical --no-verify-jwt
   supabase functions deploy ical-export --no-verify-jwt
   supabase functions deploy invite-user
   supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
   ```
4. En **Authentication → Providers → Email**, desactiva *Allow new users to sign up* (el personal lo dan de alta los responsables).
5. Crea el **primer responsable**: *Authentication → Users → Add user* (marca *Auto confirm*) y después, en el SQL Editor:
   ```sql
   update public.profiles set role = 'manager', full_name = 'Tu Nombre'
   where id = (select id from auth.users where email = 'tu@email.com');
   ```
   A partir de aquí, el resto del personal se crea desde **Ajustes → Personal** en la app.
6. (Opcional) Sincronización automática cada 15 min: sigue las instrucciones de `supabase/migrations/20261003000100_cron_sync.sql`.

### 2. Frontend

```bash
cp .env.example .env     # rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173
```

### 3. Despliegue gratuito

- **Vercel**: *Import project* → framework Vite → añade las dos variables `VITE_SUPABASE_*`. `vercel.json` ya incluye la regla SPA.
- **Netlify / Cloudflare Pages**: build `npm run build`, carpeta `dist` (`public/_redirects` incluido).
- Añade la URL final en Supabase → *Authentication → URL Configuration → Site URL*.

### 4. Conectar Booking y Airbnb

1. **Importar** (canal → app): en Booking *Extranet → Tarifas y disponibilidad → Sincronizar calendarios* y en Airbnb *Calendario → Disponibilidad → Conectar calendarios*, copia el enlace de exportación de cada habitación y pégalo en **Ajustes → Canales e iCal**.
2. **Exportar** (app → canal): en el mismo apartado copia el enlace de cada habitación y pégalo como *Importar calendario* en Booking/Airbnb. Así se bloquean en los canales las fechas vendidas por otro lado.
3. Pulsa **Sincronizar canales** en el Calendario (o activa el cron).

> iCal es el estándar gratuito que ofrecen todas las OTAs, pero se actualiza cada 15-60 min y no trae precios ni datos del huésped. Para sincronización instantánea con tarifas, el siguiente paso es un *channel manager* con API (Beds24, Channex, Smoobu, Cloudbeds…), que encaja en la misma tabla `reservations`.

### 5. Instalar en el móvil (limpiadoras)

Abre la URL en el móvil → menú del navegador → **Añadir a pantalla de inicio**. Se abre a pantalla completa como una app.

## Uso diario

**Responsable**
1. *Reservas → Pendientes*: abre cada reserva, elige habitación (solo se ofrecen las libres), revisa el estado y las incidencias de la última limpieza y **Acepta** o **Rechaza**.
2. *Órdenes → Generar por salidas* y asigna cada habitación a una limpiadora (o crea órdenes manuales: repaso, limpieza a fondo, mantenimiento).
3. Sigue el avance en vivo (notificaciones, *Habitaciones*, *Dashboard*) y **Verifica** las habitaciones terminadas.

**Limpiadora**
1. Abre la app: ve sus tareas de hoy ordenadas por prioridad.
2. *Empezar limpieza* → marca el checklist → valora cómo encontró la habitación.
3. Escribe observaciones; marca *Es una incidencia* y añade foto si algo está roto o falta.
4. *Habitación terminada*.

## Desarrollo

```bash
npm run typecheck
npm run build
```

## Siguientes pasos sugeridos

- Channel manager con API (Beds24 / Channex) para tarifas y disponibilidad instantánea.
- Notificaciones push (Web Push) a las limpiadoras con la app cerrada.
- Facturación / cobros (Stripe) y registro de viajeros (SES Hospedajes, obligatorio en España).
- Agente de IA (LangGraph o Claude API) que resuma semanalmente las observaciones de limpieza, detecte habitaciones con incidencias recurrentes y proponga mantenimiento preventivo.
- Inventario de lencería y amenities.
