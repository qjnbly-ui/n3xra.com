const json = (body, status) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });

export async function POST() {
  return json(
    {
      error: "This portfolio demo is inactive and does not accept or store form submissions."
    },
    410
  );
}
