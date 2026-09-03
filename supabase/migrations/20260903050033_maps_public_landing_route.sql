update public.n3xra_product_catalog
set
  portal_path = '/maps/app/',
  updated_at = now()
where product_key = 'maps';
