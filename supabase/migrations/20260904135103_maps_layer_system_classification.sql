alter table public.map_layers
  add column standard_key text,
  add column system_type text not null default 'other';

alter table public.map_layers
  add constraint map_layers_standard_key_check
    check (standard_key is null or standard_key ~ '^[a-z][a-z0-9-]{0,49}$'),
  add constraint map_layers_system_type_check
    check (system_type in ('potable_water', 'sanitary_sewer', 'stormwater', 'reclaimed_water', 'reference', 'other'));

update public.map_layers
set standard_key = case lower(trim(name))
    when 'water mains' then 'water-main'
    when 'water service lines' then 'water-service'
    when 'water meters' then 'water-meter'
    when 'water valves' then 'water-valve'
    when 'fire hydrants' then 'fire-hydrant'
    when 'wells' then 'well'
    when 'storage tanks' then 'storage'
    when 'sanitary sewer mains' then 'sewer-main'
    when 'sewer manholes' then 'sewer-manhole'
    when 'sewer cleanouts' then 'cleanout'
    when 'lift stations' then 'lift-station'
    when 'storm inlets' then 'storm-inlet'
    when 'reclaimed water mains' then 'reclaimed-main'
    when 'service area boundary' then 'service-boundary'
    when 'tax parcels' then 'parcel'
    else null
  end
where standard_key is null;

update public.map_layers
set system_type = case
    when standard_key in ('water-main', 'water-service', 'water-meter', 'water-valve', 'fire-hydrant', 'well', 'storage') then 'potable_water'
    when standard_key in ('sewer-main', 'sewer-manhole', 'cleanout', 'lift-station') then 'sanitary_sewer'
    when standard_key = 'storm-inlet' then 'stormwater'
    when standard_key = 'reclaimed-main' then 'reclaimed_water'
    when standard_key in ('service-boundary', 'parcel') then 'reference'
    else system_type
  end;

create index map_layers_organization_system_idx
  on public.map_layers (organization_id, system_type)
  where archived_at is null;

create or replace function private.validate_map_water_break_layer()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
begin
  if not exists (
    select 1
    from public.map_features feature
    join public.map_layers layer
      on layer.organization_id = feature.organization_id
     and layer.id = feature.layer_id
    where feature.organization_id = new.organization_id
      and feature.id = new.feature_id
      and feature.geometry_type = 'line'
      and feature.archived_at is null
      and layer.system_type = 'potable_water'
      and layer.archived_at is null
  ) then
    raise exception 'Water-main breaks must be linked to an active potable-water line.' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists map_incidents_validate_water_layer on public.map_incidents;
create trigger map_incidents_validate_water_layer
before insert or update of organization_id, feature_id on public.map_incidents
for each row execute function private.validate_map_water_break_layer();
