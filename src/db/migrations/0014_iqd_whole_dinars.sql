-- The business works in whole dinars (final amounts are rounded to 250 IQD by setting).
UPDATE currencies SET minor_units = 0 WHERE code = 'IQD';
