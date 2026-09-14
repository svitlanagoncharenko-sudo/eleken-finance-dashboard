// TEMPORARY diagnostic endpoint — inspects a specific sheet tab by gid
// via the same service account, and reports any #REF!/#ERROR cells with
// their row/column position. Safe to delete once debugging is done.

import { JWT } from 'google-auth-library';

const SHEET_ID = '1lka_Y20sFi9g6i4YOvfrOLmD40GVLc8XOLkWVHVO7lg';

export default async function handler(req, res) {
  try {
    const gid = Number(req.query.gid || 1726811473);

    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!rawKey) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set');
    const key = JSON.parse(rawKey);

    const client = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    await client.authorize();

    const metaResp = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
    });
    const sheetMeta = (metaResp.data.sheets || []).find(s => s.properties.sheetId === gid);
    if (!sheetMeta) {
      res.status(404).json({
        error: `No tab found for gid=${gid}`,
        availableTabs: (metaResp.data.sheets || []).map(s => ({ title: s.properties.title, gid: s.properties.sheetId })),
      });
      return;
    }
    const title = sheetMeta.properties.title;

    const valuesResp = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(title)}`,
    });
    const grid = valuesResp.data.values || [];

    // Find every cell that looks like an error
    const errors = [];
    grid.forEach((row, r) => {
      (row || []).forEach((cell, c) => {
        if (typeof cell === 'string' && /#REF!|#ERROR!|#N\/A|#VALUE!|#DIV\/0!/.test(cell)) {
          errors.push({ row: r + 1, col: c + 1, value: cell, rowLabel: (row[0] || row[1] || row[2] || '').toString().trim() });
        }
      });
    });

    // First ~10 non-empty cells of each of the first 60 rows, for structural context
    const preview = grid.slice(0, 60).map((row, r) => ({
      row: r + 1,
      cells: (row || []).slice(0, 12),
    }));

    res.status(200).json({
      tabTitle: title,
      gid,
      totalRows: grid.length,
      errorsFound: errors.length,
      errors,
      preview,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
