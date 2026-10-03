-- Reference units. Volume and mass are separate dimensions; no implicit L<->KG conversion.
INSERT INTO units (code, name, dimension, to_base) VALUES
  ('KG', 'Kilogram', 'mass', 1),
  ('MT', 'Metric ton', 'mass', 1000),
  ('L', 'Litre', 'volume', 1),
  ('M3', 'Cubic metre', 'volume', 1000),
  ('EA', 'Each', 'count', 1),
  ('HR', 'Hour', 'time', 1),
  ('DAY', 'Day', 'time', 24),
  ('KM', 'Kilometre', 'length', 1000);
