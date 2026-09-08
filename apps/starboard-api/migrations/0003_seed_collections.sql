INSERT OR IGNORE INTO collections (id, name, description, icon, color, rule_json, built_in) VALUES
  ('all', 'All saves', 'Everything from every connected source.', 'inbox', '#a9b6ad', '{}', 1),
  ('unread', 'Unread', 'Saved things you have not opened yet.', 'sparkles', '#f6c453', '{"unreadOnly":true}', 1),
  ('pinned', 'Pinned', 'Your small set of things worth keeping close.', 'bookmark', '#f28a6b', '{"pinnedOnly":true}', 1),
  ('github-stars', 'GitHub stars', 'Every repository starred on GitHub.', 'github', '#8b7cff', '{"providerIds":["github"]}', 1),
  ('tangled-stars', 'Tangled stars', 'Every repository starred on Tangled.', 'branch', '#54c7a8', '{"providerIds":["tangled"]}', 1),
  ('reading-queue', 'Reading queue', 'Ideas and links tagged read-later.', 'layers', '#d18df2', '{"tags":["read-later"]}', 0);
