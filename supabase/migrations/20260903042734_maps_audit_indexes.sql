create index map_layers_created_by_user_idx
  on public.map_layers (created_by_user_id)
  where created_by_user_id is not null;
create index map_layers_updated_by_user_idx
  on public.map_layers (updated_by_user_id)
  where updated_by_user_id is not null;
create index map_features_created_by_user_idx
  on public.map_features (created_by_user_id)
  where created_by_user_id is not null;
create index map_features_updated_by_user_idx
  on public.map_features (updated_by_user_id)
  where updated_by_user_id is not null;
