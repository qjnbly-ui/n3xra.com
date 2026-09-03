create index if not exists map_layer_fields_created_by_user_idx
  on public.map_layer_fields (created_by_user_id);

create index if not exists map_feature_photos_created_by_user_idx
  on public.map_feature_photos (created_by_user_id);
