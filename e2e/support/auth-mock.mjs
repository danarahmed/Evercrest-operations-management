// Local stand-in for Supabase (Auth: password sign-in, current user, sign-out, invitations; Storage: buckets). Test use only.

import http from "node:http";
const users = { "admin@evercrest.local": { id: "11111111-1111-4111-8111-111111111111", password: "correct-horse-1" }, "stranger@gmail.com": { id: "22222222-2222-4222-8222-222222222222", password: "correct-horse-1" } };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (u, email) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userObj = (email) => ({ id: users[email].id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const tokens = new Map();
const buckets = new Map();
const invites = [];
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      const { email, password } = JSON.parse(body || "{}");
      const u = users[email];
      if (!u || u.password !== password) return send(400, { error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", msg: "Invalid login credentials" });
      const access = jwt(u, email);
      tokens.set(access, email);
      return send(200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + u.id, user: userObj(email) });
    }
    if (url.pathname === "/auth/v1/user") {
      const t = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const email = tokens.get(t);
      return email ? send(200, userObj(email)) : send(401, { code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") { const t = (req.headers.authorization ?? "").replace(/^Bearer /, ""); tokens.delete(t); res.writeHead(204); return res.end(); }
    // Storage buckets (first-run setup)
    if (url.pathname === "/storage/v1/bucket/documents" && req.method === "GET") return buckets.has("documents") ? send(200, buckets.get("documents")) : send(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    if (url.pathname === "/storage/v1/bucket" && req.method === "POST") { const b = JSON.parse(body); buckets.set(b.name ?? b.id, b); return send(200, { name: b.name ?? b.id }); }
    if (url.pathname === "/storage/v1/bucket/documents" && req.method === "PUT") { buckets.set("documents", { ...buckets.get("documents"), ...JSON.parse(body) }); return send(200, { message: "Successfully updated" }); }
    // Invitations
    if (url.pathname === "/auth/v1/invite" && req.method === "POST") { const { email } = JSON.parse(body); invites.push({ email, redirectTo: url.searchParams.get("redirect_to") }); return send(200, { id: "33333333-3333-4333-8333-333333333333", email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} }); }
    // What the test can check afterwards
    if (url.pathname === "/__state") return send(200, { buckets: [...buckets.values()], invites });
    send(404, { msg: "not mocked: " + req.method + " " + url.pathname });
  });
}).listen(54321, () => console.log("auth mock on 54321"));
