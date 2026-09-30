const base = process.env.DEMO_URL || "http://localhost:9000";
const command = process.argv[2] || "submit";
async function api(path, method = "GET", body, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.message}`);
  return data;
}
const { token } = await api("/auth/customer/emailpass", "POST", {
  email: process.env.DEMO_EMAIL || "buyer@acme.demo",
  password: process.env.DEMO_PASSWORD || "RigbyDemo2026!",
});
if (command === "submit") {
  const { cart } = await api(
    "/b2b/carts",
    "POST",
    { basket: process.argv[3] || "clean" },
    token,
  );
  const { approval_request } = await api(
    "/b2b/requests",
    "POST",
    { cart_id: cart.id },
    token,
  );
  console.log(JSON.stringify(approval_request, null, 2));
  console.log(
    `Review at ${base}/app/approvals; then: npm run demo -- status ${approval_request.id}`,
  );
} else if (command === "status" && process.argv[3]) {
  console.log(
    JSON.stringify(
      await api(
        `/b2b/requests/${encodeURIComponent(process.argv[3])}`,
        "GET",
        undefined,
        token,
      ),
      null,
      2,
    ),
  );
} else
  throw new Error(
    "Usage: npm run demo -- submit [clean|manual|failure] | status <request-id>",
  );
