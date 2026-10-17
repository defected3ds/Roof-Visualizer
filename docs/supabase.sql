-- Cost history for Roof Visualizer (Admin > Costs).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists usage_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  kind          text not null,          -- image | depth | roof-mask | test-image | test-depth | test-roof-mask
  photo_id      text,                   -- random id of the picked photo (groups depth map, roof mask and generations)
  generation_id text,                   -- random id of one Generate press
  product       text,
  provider      text,
  model         text,
  results       integer,
  ms            integer,
  cost          numeric(10,5) not null default 0,   -- estimated US dollars
  detail        jsonb,
  previews      jsonb                   -- small previews; removed after the retention period
);

create index if not exists usage_events_created_at_idx on usage_events (created_at desc);
create index if not exists usage_events_generation_idx on usage_events (generation_id);

-- Only the server (with the secret service key) may read or write. No public access.
alter table usage_events enable row level security;
