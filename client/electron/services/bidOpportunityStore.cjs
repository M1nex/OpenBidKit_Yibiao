function noticeFromRow(row) {
  if (!row) return null;
  return {
    id: row.notice_id,
    sourceId: row.source_id,
    sourceNoticeId: row.source_notice_id,
    noticeType: row.notice_type,
    rawNoticeType: row.raw_notice_type,
    title: row.title,
    publishedAt: row.published_at,
    publishedDate: row.published_date,
    regionLabel: row.region_label,
    regionBasis: row.region_basis,
    procuringEntity: row.procuring_entity,
    sourceUrl: row.source_url,
    updatedAt: row.updated_at,
    detailFetchedAt: row.detail_fetched_at,
  };
}

function queryFromRow(row) {
  return row ? {
    queryKey: row.query_key, sourceId: row.source_id, date: row.query_date,
    keyword: row.keyword, status: row.status, complete: Boolean(row.complete),
    remoteTotal: row.remote_total, lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at, error: row.error, warning: row.warning,
  } : null;
}

function createBidOpportunityStore({ db }) {
  const saveNotice = db.prepare(`INSERT INTO bid_opportunity_notices (
    notice_id, source_id, source_notice_id, notice_type, raw_notice_type, title,
    published_at, published_date, region_label, region_basis, procuring_entity,
    source_url, source_reference_json, updated_at
  ) VALUES (
    @id, @sourceId, @sourceNoticeId, @noticeType, @rawNoticeType, @title,
    @publishedAt, @publishedDate, @regionLabel, @regionBasis, @procuringEntity,
    @sourceUrl, @sourceReferenceJson, @updatedAt
  ) ON CONFLICT(notice_id) DO UPDATE SET
    notice_type=excluded.notice_type, raw_notice_type=excluded.raw_notice_type,
    title=excluded.title, published_at=excluded.published_at, published_date=excluded.published_date,
    region_label=excluded.region_label, region_basis=excluded.region_basis,
    procuring_entity=excluded.procuring_entity, source_url=excluded.source_url,
    source_reference_json=excluded.source_reference_json, updated_at=excluded.updated_at`);

  function getQuery(queryKey) {
    return queryFromRow(db.prepare('SELECT * FROM bid_opportunity_queries WHERE query_key=?').get(queryKey));
  }

  // 只有完整成功的刷新才替换查询成员；中途失败保留旧成员并合并已取得的公告。
  const saveQuery = db.transaction((query, notices) => {
    const previous = getQuery(query.queryKey);
    const timestamp = new Date().toISOString();
    for (const notice of notices) {
      saveNotice.run({ ...notice, sourceReferenceJson: JSON.stringify(notice.sourceReference || {}), updatedAt: timestamp });
    }
    db.prepare(`INSERT INTO bid_opportunity_queries (
      query_key, source_id, query_date, keyword, status, complete, remote_total,
      last_checked_at, last_success_at, error, warning
    ) VALUES (@queryKey, @sourceId, @date, @keyword, @status, @complete, @remoteTotal,
      @lastCheckedAt, @lastSuccessAt, @error, @warning)
    ON CONFLICT(query_key) DO UPDATE SET status=excluded.status, complete=excluded.complete,
      remote_total=excluded.remote_total, last_checked_at=excluded.last_checked_at,
      last_success_at=excluded.last_success_at, error=excluded.error, warning=excluded.warning`).run({
      ...query, complete: Number(query.complete), remoteTotal: query.remoteTotal ?? null,
      lastCheckedAt: timestamp,
      lastSuccessAt: query.complete ? timestamp : previous?.lastSuccessAt || null,
      error: query.error || null, warning: query.warning || null,
    });
    if (query.complete) db.prepare('DELETE FROM bid_opportunity_query_items WHERE query_key=?').run(query.queryKey);
    const addItem = db.prepare('INSERT OR IGNORE INTO bid_opportunity_query_items(query_key, notice_id) VALUES (?, ?)');
    for (const notice of notices) addItem.run(query.queryKey, notice.id);
    return getQuery(query.queryKey);
  });

  function list(queryKeys, page = 1, pageSize = 20, filters = {}) {
    if (!queryKeys.length) return { items: [], total: 0, page: 1, pageSize };
    const placeholders = queryKeys.map(() => '?').join(',');
    const conditions = [`n.notice_id IN (SELECT notice_id FROM bid_opportunity_query_items WHERE query_key IN (${placeholders}))`];
    const values = [...queryKeys];
    if (filters.date) {
      conditions.push('n.published_date = ?');
      values.push(filters.date);
    }
    if (filters.keyword) {
      conditions.push('LOWER(n.title) LIKE ?');
      values.push(`%${String(filters.keyword).toLowerCase()}%`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    return db.transaction(() => {
      const total = db.prepare(`SELECT COUNT(*) AS total FROM bid_opportunity_notices n ${where}`).get(...values).total;
      const actualPage = Math.max(1, Math.min(page, Math.ceil(total / pageSize) || 1));
      const rows = db.prepare(`SELECT n.* FROM bid_opportunity_notices n ${where}
        ORDER BY n.published_at DESC, n.source_id, n.source_notice_id LIMIT ? OFFSET ?`)
        .all(...values, pageSize, (actualPage - 1) * pageSize);
      return { items: rows.map(noticeFromRow), total, page: actualPage, pageSize };
    })();
  }

  function getNotice(id) {
    const row = db.prepare('SELECT * FROM bid_opportunity_notices WHERE notice_id=?').get(id);
    if (!row) return null;
    let sourceReference = {};
    try { sourceReference = JSON.parse(row.source_reference_json || '{}'); } catch {}
    return { ...noticeFromRow(row), sourceReference, bodyHtml: row.body_html, detailError: row.detail_error };
  }

  function saveDetail(id, bodyHtml) {
    db.prepare(`UPDATE bid_opportunity_notices SET body_html=?, detail_fetched_at=?, detail_error=NULL WHERE notice_id=?`)
      .run(bodyHtml, new Date().toISOString(), id);
    return getNotice(id);
  }

  function saveDetailError(id, message) {
    db.prepare('UPDATE bid_opportunity_notices SET detail_error=? WHERE notice_id=?').run(message, id);
  }

  return { getQuery, saveQuery, list, getNotice, saveDetail, saveDetailError };
}

module.exports = { createBidOpportunityStore };
