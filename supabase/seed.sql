-- Datos iniciales: 15 habitaciones, canales y plantillas de checklist
insert into public.rooms (number, room_type, floor, capacity) values
  ('101', 'Doble', 1, 2), ('102', 'Doble', 1, 2), ('103', 'Twin', 1, 2), ('104', 'Individual', 1, 1), ('105', 'Suite', 1, 4),
  ('201', 'Doble', 2, 2), ('202', 'Doble', 2, 2), ('203', 'Twin', 2, 2), ('204', 'Triple', 2, 3), ('205', 'Suite', 2, 4),
  ('301', 'Doble', 3, 2), ('302', 'Doble', 3, 2), ('303', 'Twin', 3, 2), ('304', 'Triple', 3, 3), ('305', 'Suite', 3, 4)
on conflict (number) do nothing;

insert into public.booking_sources (name, color, auto_confirm) values
  ('Booking.com', '#003580', false),
  ('Airbnb',      '#ff5a5f', false),
  ('Expedia',     '#f5b800', false),
  ('Directo',     '#10b981', true),
  ('Web del hotel', '#7c3aed', false)
on conflict (name) do nothing;

-- Precio orientativo por noche (se muestra en el formulario público)
update public.rooms set base_price = case room_type
  when 'Individual' then 65 when 'Twin' then 80 when 'Doble' then 85 when 'Triple' then 110 when 'Suite' then 160 else 85 end;

insert into public.checklist_templates (name, order_type, items) values
  ('Limpieza de salida', 'checkout_clean', '[
    {"key": "ventilar",   "label": "Ventilar la habitación"},
    {"key": "sabanas",    "label": "Cambiar sábanas y fundas"},
    {"key": "toallas",    "label": "Cambiar toallas"},
    {"key": "bano",       "label": "Limpiar y desinfectar baño"},
    {"key": "amenities",  "label": "Reponer amenities (gel, champú, papel)"},
    {"key": "polvo",      "label": "Quitar polvo de superficies"},
    {"key": "suelo",      "label": "Aspirar y fregar suelo"},
    {"key": "papeleras",  "label": "Vaciar papeleras"},
    {"key": "minibar",    "label": "Revisar y reponer minibar"},
    {"key": "objetos",    "label": "Revisar objetos olvidados"},
    {"key": "luces",      "label": "Comprobar luces, TV y aire acondicionado"}
  ]'::jsonb),
  ('Repaso (cliente alojado)', 'stayover', '[
    {"key": "cama",       "label": "Hacer la cama"},
    {"key": "toallas",    "label": "Cambiar toallas si están en el suelo"},
    {"key": "bano",       "label": "Repasar baño"},
    {"key": "amenities",  "label": "Reponer amenities"},
    {"key": "papeleras",  "label": "Vaciar papeleras"}
  ]'::jsonb),
  ('Limpieza a fondo', 'deep_clean', '[
    {"key": "colchon",    "label": "Girar y aspirar colchón"},
    {"key": "cortinas",   "label": "Lavar cortinas"},
    {"key": "cristales",  "label": "Limpiar cristales"},
    {"key": "armarios",   "label": "Limpiar interior de armarios"},
    {"key": "juntas",     "label": "Limpiar juntas del baño"},
    {"key": "rejillas",   "label": "Limpiar rejillas de ventilación"}
  ]'::jsonb),
  ('Revisión de responsable', 'inspection', '[
    {"key": "olor",       "label": "Sin olores"},
    {"key": "cama",       "label": "Cama perfecta"},
    {"key": "bano",       "label": "Baño impecable"},
    {"key": "amenities",  "label": "Amenities completas"}
  ]'::jsonb);
