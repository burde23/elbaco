/**
 * El Baco Redwine — Cloudflare Pages Function
 * Archivo: functions/orders.js
 * URL resultante: https://tu-sitio.pages.dev/orders
 *
 * RUTAS:
 *   POST  /orders        → crear pedido
 *   GET   /orders        → listar pedidos (?estado=pendiente&page=1&limit=50)
 *   GET   /orders/:id    → detalle de un pedido
 *   PATCH /orders/:id    → cambiar estado
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function initDB(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS orders (
      id            TEXT PRIMARY KEY,
      fecha         TEXT NOT NULL,
      cliente_nom   TEXT NOT NULL,
      cliente_email TEXT NOT NULL,
      cliente_tel   TEXT,
      envio_dir     TEXT,
      envio_ciudad  TEXT,
      envio_prov    TEXT,
      envio_cp      TEXT,
      envio_notas   TEXT,
      items_json    TEXT NOT NULL,
      total         REAL NOT NULL,
      estado        TEXT DEFAULT 'pendiente',
      created_at    TEXT DEFAULT (datetime('now'))
    )`
  ).run();
}

function parseRow(row) {
  return {
    ...row,
    items: (() => { try { return JSON.parse(row.items_json); } catch { return []; } })()
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const db = env.DB;
  if (!db) return json({ error: 'DB no configurada' }, 500);

  await initDB(db);

  const url     = new URL(request.url);
  const orderId = params.id || null;   // viene de /orders/[id].js si usás ese patrón

  try {
    // ── POST /orders ─────────────────────────────────────────────────────
    if (request.method === 'POST') {
      const body = await request.json();
      const { orden, fecha, cliente = {}, envio = {}, items = [], total, estado = 'pendiente' } = body;

      if (!orden || !items.length || total == null) {
        return json({ error: 'Faltan campos: orden, items, total' }, 400);
      }

      await db.prepare(`
        INSERT INTO orders
          (id, fecha, cliente_nom, cliente_email, cliente_tel,
           envio_dir, envio_ciudad, envio_prov, envio_cp, envio_notas,
           items_json, total, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orden,
        fecha || new Date().toISOString(),
        cliente.nombre   || '',
        cliente.email    || '',
        cliente.telefono || '',
        envio.direccion  || '',
        envio.ciudad     || '',
        envio.provincia  || '',
        envio.cp         || '',
        envio.notas      || '',
        JSON.stringify(items),
        total,
        estado
      ).run();

      return json({ ok: true, orden }, 201);
    }

    // ── GET /orders ───────────────────────────────────────────────────────
    if (request.method === 'GET' && !orderId) {
      const page   = parseInt(url.searchParams.get('page')  || '1');
      const limit  = parseInt(url.searchParams.get('limit') || '50');
      const estado = url.searchParams.get('estado') || null;
      const offset = (page - 1) * limit;

      let query  = 'SELECT * FROM orders';
      let args   = [];
      if (estado) { query += ' WHERE estado = ?'; args.push(estado); }
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      args.push(limit, offset);

      const { results } = await db.prepare(query).bind(...args).all();

      const countQ = estado
        ? 'SELECT COUNT(*) as n FROM orders WHERE estado = ?'
        : 'SELECT COUNT(*) as n FROM orders';
      const { results: cr } = await db.prepare(countQ).bind(...(estado ? [estado] : [])).all();

      return json({ orders: results.map(parseRow), total_count: cr[0]?.n || 0, page, limit });
    }

    // ── GET /orders/:id ───────────────────────────────────────────────────
    if (request.method === 'GET' && orderId) {
      const { results } = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).all();
      if (!results.length) return json({ error: 'Pedido no encontrado' }, 404);
      return json(parseRow(results[0]));
    }

    // ── PATCH /orders/:id ─────────────────────────────────────────────────
    if (request.method === 'PATCH' && orderId) {
      const { estado } = await request.json();
      const VALID = ['pendiente', 'confirmado', 'enviado', 'cancelado'];
      if (!VALID.includes(estado)) {
        return json({ error: `Estado inválido. Opciones: ${VALID.join(', ')}` }, 400);
      }
      await db.prepare('UPDATE orders SET estado = ? WHERE id = ?').bind(estado, orderId).run();
      return json({ ok: true, id: orderId, estado });
    }

    // ── DELETE /orders/:id ────────────────────────────────────────────────
    if (request.method === 'DELETE' && orderId) {
      await db.prepare('DELETE FROM orders WHERE id = ?').bind(orderId).run();
      return json({ ok: true, id: orderId, deleted: true });
    }

    return json({ error: 'Method not allowed' }, 405);

  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
}
