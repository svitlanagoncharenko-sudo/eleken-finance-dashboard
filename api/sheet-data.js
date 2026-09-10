// Vercel serverless function: securely fetches data from a PRIVATE Google Sheet
// using a service account. The sheet is never made public — only the service
// account (whose email you share the sheet with) can read it, and the
// credentials live only in the Vercel environment variable, never in the browser.

import { JWT } from 'google-auth-library';

const SHEET_ID = '1lka_Y20sFi9g6i4YOvfrOLmD40GVLc8XOLkWVHVO7lg';
const GID = 323218510; // PL_ELEKEN_2024_2025_2026

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildFullMonthKeys() {
  const keys = [];
  for (const yy of [24, 25, 26]) {
    for (let m = 1; m <= 12; m++) keys.push(String(m).padStart(2, '0') + '.' + yy);
  }
  return keys;
}
const FULL_MONTH_KEYS = buildFullMonthKeys();

function findCell(grid, label) {
  const target = label.trim().toLowerCase();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (typeof v === 'string' && v.trim().toLowerCase() === target) return { r, c };
    }
  }
  return null;
}

function extractSeries(grid, label, count) {
  const pos = findCell(grid, label);
  if (!pos) return null;
  const row = grid[pos.r] || [];
  const values = [];
  for (let i = pos.c + 1; values.length < count && i < row.length; i++) {
    const raw = row[i];
    let num = 0;
    if (typeof raw === 'number') num = raw;
    else if (typeof raw === 'string') {
      const cleaned = raw.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
      num = cleaned ? parseFloat(cleaned) : 0;
    }
    values.push(isNaN(num) ? 0 : num);
  }
  while (values.length < count) values.push(0);
  return values;
}

function trimTrailingZero(arr) {
  let len = arr.length;
  while (len > 1 && !arr[len - 1]) len--;
  return arr.slice(0, len);
}

export default async function handler(req, res) {
  try {
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!rawKey) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY environment variable is not set');
    const key = JSON.parse(rawKey);

    const client = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    await client.authorize();

    // Resolve the gid to its sheet/tab title (the Values API needs a name, not a gid)
    const metaResp = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`,
    });
    const sheetMeta = (metaResp.data.sheets || []).find(s => s.properties.sheetId === GID);
    if (!sheetMeta) throw new Error(`No sheet tab found for gid=${GID}. Check the GID is correct.`);
    const title = sheetMeta.properties.title;

    const valuesResp = await client.request({
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(title)}`,
    });
    const grid = valuesResp.data.values || [];

    const series = {
      revenue: extractSeries(grid, 'Revenue Total', 36),
      netIncome: extractSeries(grid, 'Net income', 36),
      cogs: extractSeries(grid, 'COGS', 36),
      marketing: extractSeries(grid, 'Marketing costs', 36),
      sales: extractSeries(grid, 'Sales costs', 36),
      outbound: extractSeries(grid, 'Outbound Sales costs', 36),
      finance: extractSeries(grid, 'Finance costs', 36),
      hr: extractSeries(grid, 'HR costs', 36),
      otherAdmin: extractSeries(grid, 'Other administrative costs', 36),
    };
    for (const k in series) {
      if (!series[k]) throw new Error(`Could not find the "${k}" row in the sheet`);
    }
    const len = trimTrailingZero(series.revenue).length;

    const pd = {
      projectCount: extractSeries(grid, 'Project count', 36),
      designTeam: extractSeries(grid, 'Design team', 36),
      qttFullTime: extractSeries(grid, 'QTT full-time', 36),
      qttPartTime: extractSeries(grid, 'QTT part-time', 36),
      revPerDesigner: extractSeries(grid, 'Revenue per designer', 36),
      revPerProject: extractSeries(grid, 'Revenue par project', 36) || extractSeries(grid, 'Revenue per project', 36),
      utilization: extractSeries(grid, 'Designer Utilization, %', 36),
    };
    const trimmed = {};
    for (const k in pd) trimmed[k] = pd[k] ? trimTrailingZero(pd[k]) : null;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      monthKeys: FULL_MONTH_KEYS.slice(0, len),
      revenue: series.revenue.slice(0, len),
      netIncome: series.netIncome.slice(0, len),
      cogs: series.cogs.slice(0, len),
      expenseCategories: {
        Marketing: series.marketing.slice(0, len),
        Sales: series.sales.slice(0, len),
        'Outbound Sales': series.outbound.slice(0, len),
        Finance: series.finance.slice(0, len),
        HR: series.hr.slice(0, len),
        'Other admin': series.otherAdmin.slice(0, len),
      },
      projectDesigner: trimmed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
