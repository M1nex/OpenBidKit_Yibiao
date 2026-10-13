/** 只读验证三个官网公开公告接口，不装配产品服务或读取用户工作区。 */
const { app, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const outputDir = path.resolve(arg('--output', path.join(os.tmpdir(), 'yibiao-bid-source-probe')));
const recentDay = arg('--recent-day', '2026-10-12');
const historicalDay = arg('--historical-day', '2026-04-13');
app.setPath('userData', path.join(outputDir, 'electron-profile'));

const sources = [
  {
    id: 'hunan', name: '中国湖南政府采购网',
    url: 'http://www.ccgp-hunan.gov.cn/portal/category',
    list: (page) => ({ pageNo: page, pageSize: 5, categoryCode: '160-945988' }),
    dates: (day) => ({ publishDateBegin: day, publishDateEnd: day }),
    keyword: { keyword: '物业' },
    read: (json) => ({ ok: json.success === true, total: json.result?.data?.total, rows: json.result?.data?.data || [] }),
    item: (row) => ({ id: row.articleId, title: row.title, publishedAt: row.publishDate, region: row.districtName }),
    detail: (row) => ({ url: 'http://www.ccgp-hunan.gov.cn/portal/detail?' + new URLSearchParams({ articleId: row.articleId, parentId: '622707' }) }),
    detailRead: (json) => ({ ok: json.success === true, data: json.result?.data }),
  },
  {
    id: 'mobile', name: '中国移动采购与招标网',
    url: 'https://b2b.10086.cn/api-b2b/api-sync-es/white_list_api/b2b/publish/queryList',
    list: (page) => ({ name: '', publishType: 'PROCUREMENT', publishOneType: 'PROCUREMENT', purchaseType: '', companyType: '', size: 5, current: page, sfactApplColumn5: 'PC' }),
    dates: (day) => ({ creationDateStart: day, creationDateEnd: day }),
    keyword: { name: '物业' },
    read: (json) => ({ ok: json.code === 0, total: json.data?.totalElements, rows: json.data?.content || [] }),
    item: (row) => ({ id: row.id, title: row.name, publishedAt: row.publishDate, unit: row.companyTypeName }),
    detail: (row) => ({ url: 'https://b2b.10086.cn/api-b2b/api-sync-es/white_list_api/b2b/publish/queryDetail', body: { publishId: row.id, publishUuid: row.uuid, publishType: 'PROCUREMENT', sfactApplColumn5: 'PC' } }),
    detailRead: (json) => ({ ok: json.code === 0, data: json.data }),
  },
  {
    id: 'telecom', name: '中国电信阳光采购网',
    url: 'https://caigou.chinatelecom.com.cn/portal/base/announcementJoin/queryListNew',
    list: (page) => ({ pageNum: page, pageSize: 5, type: 'e2no', provinceCode: '', noticeSummary: '' }),
    dates: (day) => ({ queryStartTime: day, queryEndTime: day, noticeSummary: '1' }),
    keyword: { title: '物业', noticeSummary: '1' },
    read: (json) => ({ ok: json.code === 200, total: json.data?.pageInfo?.total, rows: json.data?.pageInfo?.list || [] }),
    item: (row) => ({ id: row.id, documentId: row.docId, title: row.docTitle, publishedAt: row.createDate, region: row.provinceName }),
    detail: (row) => ({ url: 'https://caigou.chinatelecom.com.cn/portal/base/tenderannouncement/view', body: { type: row.docTypeCode, id: row.docId, securityViewCode: row.securityViewCode } }),
    detailRead: (json) => ({ ok: json.code === 200, data: json.data }),
  },
];

async function request(url, body) {
  const response = await net.fetch(url, {
    method: body ? 'POST' : 'GET',
    credentials: 'omit',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  try {
    return { status: response.status, json: JSON.parse(text) };
  } catch {
    throw new Error(`HTTP ${response.status} 未返回JSON：${text.slice(0,120)}`);
  }
}

async function log(record) {
  await fs.appendFile(path.join(outputDir, 'probe.log'), `${JSON.stringify(record)}\n`, 'utf8');
}

async function probe(source) {
  const evidence = [], results = [];
  let firstRow;
  for (const [test, patch] of [
    ['page-1', {}], ['page-2', {}],
    ['recent-date', source.dates(recentDay)],
    ['historical-date', source.dates(historicalDay)],
    ['keyword', source.keyword],
  ]) {
    const body = { ...source.list(test === 'page-2' ? 2 : 1), ...patch };
    try {
      const response = await request(source.url, body);
      const data = source.read(response.json);
      if (test === 'page-1') firstRow = data.rows[0];
      const result = { test, httpStatus: response.status, ok: data.ok, total: data.total, count: data.rows.length, sample: data.rows.slice(0,2).map(source.item) };
      results.push(result);
      evidence.push({ test, url: source.url, body, ...response });
      await log({ source: source.id, ...result });
    } catch (error) {
      results.push({ test, ok: false, error: error.message });
      await log({ source: source.id, test, error: error.message });
    }
  }
  if (firstRow) {
    const detail = source.detail(firstRow);
    try {
      const response = await request(detail.url, detail.body);
      const value = source.detailRead(response.json);
      const textFields = Object.entries(value.data || {}).filter(([key, value]) => /content|context|body|summary|description/i.test(key) && typeof value === 'string').map(([key, value]) => ({ field: key, length: value.length }));
      const result = { test: 'detail', ok: value.ok, httpStatus: response.status, fields: Object.keys(value.data || {}), textFields };
      results.push(result);
      evidence.push({ test: 'detail', ...detail, ...response });
      await log({ source: source.id, test: 'detail', ok: result.ok, httpStatus: result.httpStatus, textFields });
    } catch (error) {
      results.push({ test: 'detail', ok: false, error: error.message });
      await log({ source: source.id, test: 'detail', error: error.message });
    }
  }
  await fs.writeFile(path.join(outputDir, `${source.id}-evidence.json`), JSON.stringify(evidence, null, 2), 'utf8');
  return { source: source.id, name: source.name, results };
}

app.whenReady().then(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const summary = { verifiedAt: new Date().toISOString(), recentDay, historicalDay, results: await Promise.all(sources.map(probe)) };
  await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  await log({ completed: true, outputDir });
  app.exit(summary.results.some((source) => source.results.some((result) => !result.ok)) ? 1 : 0);
}).catch(async (error) => {
  await log({ fatal: true, error: error.message }).catch(() => {});
  app.exit(1);
});
