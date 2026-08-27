ALTER TABLE matches
  DROP CHECK matches_reason_chk,
  ADD CONSTRAINT matches_reason_chk CHECK (status_reason IS NULL OR status_reason IN (
    'checkmate', 'stalemate', 'resignation', 'agreement', 'repetition', 'natural-limit',
    'move-limit', 'disconnect', 'abandoned', 'five', 'forbidden', 'full-board', 'timeout'
  ));
