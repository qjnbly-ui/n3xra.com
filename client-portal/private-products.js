export function privateProductPath(path, organizationId, productId) {
    if (!/^\/[^/]/.test(path) || /[\s\\?#%]/.test(path) || path.includes(".."))
        return "";
    const query = new URLSearchParams({ organization: organizationId, organization_product: productId });
    return `${path}?${query}`;
}
export async function loadPrivateProducts(supabase, organizationId) {
    const { data, error } = await supabase.from("organization_private_products")
        .select("id,organization_id,name,description,app_path,status")
        .eq("organization_id", organizationId).eq("status", "active").order("name");
    if (error)
        throw error;
    return data || [];
}
