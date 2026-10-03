-- At most one live (posted) settlement per trip; a reversed one can be replaced.
CREATE UNIQUE INDEX trip_settlements_one_posted ON trip_settlements (trip_id) WHERE status = 'posted';
