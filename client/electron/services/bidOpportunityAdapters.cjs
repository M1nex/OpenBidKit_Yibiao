const { net } = require('electron');
const { getHunanSourceUrl, getHunanDetailApiUrl } = require('./bidOpportunityUrls.cjs');

const SOURCES = [
  { id: 'hunan', name: '中国湖南政府采购网', baseUrl: 'http://www.ccgp-hunan.gov.cn/' },
  { id: 'mobile', name: '中国移动采购与招标网', baseUrl: 'https://b2b.10086.cn/' },
  { id: 'telecom', name: '中国电信阳光采购网', baseUrl: 'https://caigou.chinatelecom.com.cn/' },
];

const TELECOM_TYPES = [
  { type: 'xi9s', rawType: 'Prequalfication', noticeType: '资格预审公告', path: '/portal/base/prequalfication/view', routeType: '6' },
  { type: 'e2no', rawType: 'TenderAnnouncement', noticeType: '招标公告', path: '/portal/base/tenderannouncement/view', routeType: '1' },
  { type: 'e3erht', rawType: 'CompareSelect', noticeType: '询比公告', path: '/portal/base/tenderannouncement/view', routeType: '3' },
  { type: 'e8vif', rawType: 'NegotiationSelect', noticeType: '谈判采购公告', path: '/portal/base/tenderannouncement/view', routeType: '5' },
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function dateText(value) {
  const text = normalizeText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function isoDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchJson(url, options = {}) {
  const response = await net.fetch(url, { redirect: 'follow', ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`来源返回的不是 JSON：${url}`);
  }
}

function jsonOptions(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function makeId(sourceId, sourceNoticeId) {
  return `${sourceId}:${String(sourceNoticeId)}`;
}

function titleMatches(notice, keyword) {
  return !keyword || notice.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

function progress(onProgress, sourceId, current, total, message) {
  onProgress?.({ sourceId, current, total, message });
}

function createHunanAdapter() {
  const source = SOURCES[0];
  function normalize(row) {
    const sourceNoticeId = normalizeText(row.articleId || row.id);
    const publishedAt = isoDateTime(row.publishDate);
    return {
      id: makeId(source.id, sourceNoticeId), sourceId: source.id, sourceNoticeId,
      noticeType: '采购公告', rawNoticeType: '160-945988', title: normalizeText(row.title),
      publishedAt, publishedDate: dateText(publishedAt),
      regionLabel: normalizeText(row.districtName || row.districtCode), regionBasis: 'source-district',
      procuringEntity: normalizeText(row.purchaseName),
      sourceUrl: getHunanSourceUrl(sourceNoticeId),
      sourceReference: row,
    };
  }
  return {
    source,
    async collect({ date, keyword, onProgress }) {
      const notices = [];
      let remoteTotal = 0;
      let page = 1;
      const pageSize = 50;
      while (page <= 100) {
        const payload = await fetchJson(`${source.baseUrl}portal/category`, jsonOptions({
          pageNo: page, pageSize, categoryCode: '160-945988', keyword: keyword || '',
          publishDateBegin: date, publishDateEnd: date,
        }));
        if (payload.success !== true) throw new Error('湖南政府采购网返回失败');
        const result = payload.result?.data || {};
        const rows = Array.isArray(result.data) ? result.data : [];
        remoteTotal = Number(result.total || remoteTotal || rows.length);
        notices.push(...rows.map(normalize).filter((notice) => titleMatches(notice, keyword)));
        progress(onProgress, source.id, page, Math.max(1, Math.ceil(remoteTotal / pageSize)), `湖南政府采购网第 ${page} 页`);
        if (!rows.length || notices.length >= remoteTotal || rows.length < pageSize) break;
        page += 1;
      }
      return { notices, remoteTotal, warning: page > 100 ? '达到单来源分页上限，结果可能不完整。' : null };
    },
    async detail(notice) {
      const payload = await fetchJson(getHunanDetailApiUrl(notice.sourceNoticeId));
      return payload.result?.data?.content || '';
    },
  };
}

function createMobileAdapter() {
  const source = SOURCES[1];
  const listPath = `${source.baseUrl}api-b2b/api-sync-es/white_list_api/b2b/publish/queryList`;
  const detailPath = `${source.baseUrl}api-b2b/api-sync-es/white_list_api/b2b/publish/queryDetail`;
  function normalize(row) {
    const sourceNoticeId = normalizeText(row.id || row.publishId || row.uuid);
    const publishedAt = isoDateTime(row.creationDate || row.publishDate || row.publishTime);
    const publishType = normalizeText(row.publishType || row.publishOneType || 'PROCUREMENT');
    const sourceUrl = `${source.baseUrl}#/noticeDetail?publishId=${encodeURIComponent(sourceNoticeId)}&publishUuid=${encodeURIComponent(row.uuid || '')}&publishType=${encodeURIComponent(publishType)}&publishOneType=${encodeURIComponent(row.publishOneType || publishType)}`;
    return {
      id: makeId(source.id, sourceNoticeId), sourceId: source.id, sourceNoticeId,
      noticeType: publishType === 'PROCUREMENT' ? '采购公告' : publishType,
      rawNoticeType: publishType, title: normalizeText(row.name || row.title), publishedAt,
      publishedDate: dateText(publishedAt), regionLabel: normalizeText(row.companyTypeName || row.companyName),
      regionBasis: 'purchasing-unit', procuringEntity: normalizeText(row.companyName || row.companyTypeName),
      sourceUrl, sourceReference: row,
    };
  }
  return {
    source,
    async collect({ date, keyword, onProgress }) {
      const notices = [];
      let remoteTotal = 0;
      let page = 1;
      const pageSize = 50;
      while (page <= 100) {
        const payload = await fetchJson(listPath, jsonOptions({
          name: keyword || '', publishType: 'PROCUREMENT', publishOneType: 'PROCUREMENT',
          purchaseType: '', companyType: '', size: pageSize, current: page,
          creationDateStart: date, creationDateEnd: date, sfactApplColumn5: 'PC',
        }));
        if (Number(payload.code) !== 0) throw new Error('中国移动采购与招标网返回失败');
        const data = payload.data || {};
        const rows = Array.isArray(data.content) ? data.content : [];
        remoteTotal = Number(data.totalElements || remoteTotal || rows.length);
        notices.push(...rows.map(normalize).filter((notice) => titleMatches(notice, keyword)));
        progress(onProgress, source.id, page, Math.max(1, Math.ceil(remoteTotal / pageSize)), `中国移动采购与招标网第 ${page} 页`);
        if (!rows.length || notices.length >= remoteTotal || rows.length < pageSize) break;
        page += 1;
      }
      return { notices, remoteTotal, warning: page > 100 ? '达到单来源分页上限，结果可能不完整。' : null };
    },
    async detail(notice) {
      const row = notice.sourceReference || {};
      const payload = await fetchJson(detailPath, jsonOptions({
        publishId: row.id || notice.sourceNoticeId, publishUuid: row.uuid || '',
        publishType: row.publishType || 'PROCUREMENT', sfactApplColumn5: 'PC',
      }));
      return payload.data?.noticeContent || '';
    },
  };
}

function createTelecomAdapter() {
  const source = SOURCES[2];
  const listPath = `${source.baseUrl}portal/base/announcementJoin/queryListNew`;
  function normalize(row, typeConfig) {
    const sourceNoticeId = normalizeText(row.docId || row.id);
    const publishedAt = isoDateTime(row.createDate || row.publishDate);
    const sourceUrl = `${source.baseUrl}DeclareDetails?id=${encodeURIComponent(sourceNoticeId)}&type=${encodeURIComponent(typeConfig.routeType)}&docTypeCode=${encodeURIComponent(row.docTypeCode || typeConfig.rawType)}&securityViewCode=${encodeURIComponent(row.securityViewCode || '')}`;
    return {
      id: makeId(source.id, `${typeConfig.type}:${sourceNoticeId}`), sourceId: source.id,
      sourceNoticeId: `${typeConfig.type}:${sourceNoticeId}`, noticeType: typeConfig.noticeType,
      rawNoticeType: normalizeText(row.docTypeCode || typeConfig.rawType), title: normalizeText(row.docTitle || row.title),
      publishedAt, publishedDate: dateText(publishedAt), regionLabel: normalizeText(row.provinceName),
      regionBasis: 'source-province', procuringEntity: '', sourceUrl,
      sourceReference: { ...row, telecomType: typeConfig.type, detailPath: typeConfig.path },
    };
  }
  return {
    source,
    async collect({ date, keyword, onProgress }) {
      const notices = [];
      let remoteTotal = 0;
      let capped = false;
      for (const typeConfig of TELECOM_TYPES) {
        let page = 1;
        const pageSize = 50;
        let typeTotal = 0;
        while (page <= 100) {
          const payload = await fetchJson(listPath, jsonOptions({
            pageNum: page, pageSize, type: typeConfig.type, title: keyword || '',
            provinceCode: '', noticeSummary: '1', queryStartTime: `${date} 00:00:00`, queryEndTime: `${date} 23:59:59`,
          }));
          if (Number(payload.code) !== 200) throw new Error('中国电信阳光采购网返回失败');
          const info = payload.data?.pageInfo || {};
          const rows = Array.isArray(info.list) ? info.list : [];
          typeTotal = Number(info.total || typeTotal || rows.length);
          notices.push(...rows.map((row) => normalize(row, typeConfig)).filter((notice) => notice.publishedDate === date && titleMatches(notice, keyword)));
          progress(onProgress, source.id, page, Math.max(1, Math.ceil(Number(info.total || rows.length) / pageSize)), `中国电信${typeConfig.noticeType}第 ${page} 页`);
          if (!rows.length || rows.length < pageSize || page >= 100) {
            if (page >= 100 && rows.length === pageSize) capped = true;
            break;
          }
          page += 1;
        }
        remoteTotal += typeTotal;
      }
      return {
        notices, remoteTotal,
        warning: `电信接口的日期条件是发售时间，已按公告时间 ${date} 在本地二次筛选。${capped ? '达到分页上限，结果可能不完整。' : ''}`,
      };
    },
    async detail(notice) {
      const row = notice.sourceReference || {};
      const payload = await fetchJson(`${source.baseUrl}${row.detailPath || '/portal/base/tenderannouncement/view'}`, jsonOptions({
        type: row.docTypeCode || row.telecomType || 'TenderAnnouncement', id: row.docId || notice.sourceNoticeId,
        securityViewCode: row.securityViewCode || '',
      }));
      return payload.data?.context || '';
    },
  };
}

function createBidOpportunityAdapters() {
  return new Map([
    ['hunan', createHunanAdapter()],
    ['mobile', createMobileAdapter()],
    ['telecom', createTelecomAdapter()],
  ]);
}

module.exports = { SOURCES, createBidOpportunityAdapters, dateText, isoDateTime, makeId };
