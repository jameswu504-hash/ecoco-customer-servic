const express = require('express');
const path = require('path');
const {
  buildOperationsReportMarkdown,
  classifyQuestion,
  getReportRange,
  makePreview,
} = require('../services/report.service');

function createReportsRouter({ pool, requireAdminKey, readJsonFile }) {
  const router = express.Router();

  router.use(requireAdminKey);

  router.get('/operations', async (req, res) => {
    const { period, start, end } = getReportRange(String(req.query.period || 'week'));
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    try {
      const databasePayload = readJsonFile(path.join('data', 'ecoco-ai-customer-service-database.json')) || {};
      const auditPayload = readJsonFile(path.join('data', 'knowledge-quality-audit.json')) || {};

      const [
        conversationCounts,
        userMessagesResult,
        ratingCounts,
        gapCounts,
        gapStatusCounts,
        gapRowsResult,
        knowledgeCounts,
        chunkCounts,
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(DISTINCT session_id) AS sessions,
                  COUNT(*) AS total_messages,
                  COUNT(*) FILTER (WHERE role = 'user') AS user_messages,
                  COUNT(*) FILTER (WHERE role = 'assistant') AS ai_replies
           FROM conversations
           WHERE timestamp >= $1 AND timestamp <= $2`,
          [startIso, endIso]
        ),
        pool.query(
          `SELECT content, timestamp
           FROM conversations
           WHERE role = 'user' AND timestamp >= $1 AND timestamp <= $2
           ORDER BY timestamp DESC
           LIMIT 500`,
          [startIso, endIso]
        ),
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE type = 'positive') AS positive,
             COUNT(*) FILTER (WHERE type = 'negative') AS negative
           FROM ratings
           WHERE timestamp >= $1 AND timestamp <= $2`,
          [startIso, endIso]
        ),
        pool.query(
          `SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE COALESCE(status, 'pending') = 'resolved') AS resolved,
             COUNT(*) FILTER (WHERE COALESCE(status, 'pending') = 'manual') AS manual
           FROM unanswered_questions
           WHERE timestamp >= $1 AND timestamp <= $2`,
          [startIso, endIso]
        ),
        pool.query(
          `SELECT COALESCE(status, 'pending') AS status, COUNT(*) AS count
           FROM unanswered_questions
           WHERE timestamp >= $1 AND timestamp <= $2
           GROUP BY COALESCE(status, 'pending')
           ORDER BY count DESC`,
          [startIso, endIso]
        ),
        pool.query(
          `SELECT id, question, reply, reason, status, note, timestamp
           FROM unanswered_questions
           WHERE timestamp >= $1 AND timestamp <= $2
           ORDER BY timestamp DESC
           LIMIT 200`,
          [startIso, endIso]
        ),
        pool.query('SELECT COUNT(*) AS count FROM knowledge_sections'),
        pool.query('SELECT COUNT(*) AS count FROM knowledge_chunks'),
      ]);

      const categories = {};
      for (const row of userMessagesResult.rows) {
        const category = classifyQuestion(row.content);
        if (!categories[category]) categories[category] = { category, count: 0, samples: [] };
        categories[category].count += 1;
        if (categories[category].samples.length < 8) {
          categories[category].samples.push({ preview: makePreview(row.content), timestamp: row.timestamp });
        }
      }

      const gapRowsByStatus = {};
      for (const row of gapRowsResult.rows) {
        const status = row.status || 'pending';
        if (!gapRowsByStatus[status]) gapRowsByStatus[status] = [];
        if (gapRowsByStatus[status].length < 8) {
          gapRowsByStatus[status].push({
            id: row.id,
            preview: makePreview(row.question),
            note: makePreview(row.note || row.reason || ''),
            timestamp: row.timestamp,
          });
        }
      }

      const conflictItems = Array.isArray(auditPayload.conflicts_pending_review)
        ? auditPayload.conflicts_pending_review.slice(0, 8).map(item => ({
            preview: item.issue || '未命名衝突',
            note: makePreview(item.recommended_resolution || item.observed_conflict || '', 120),
            priority: item.priority || '',
          }))
        : [];

      const positive = Number(ratingCounts.rows[0].positive || 0);
      const negative = Number(ratingCounts.rows[0].negative || 0);
      const ratingTotal = positive + negative;
      const payload = {
        generatedAt: new Date().toISOString(),
        range: {
          period,
          start: startIso,
          end: endIso,
          startDate: start.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }),
          endDate: end.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }),
        },
        summary: {
          sessions: Number(conversationCounts.rows[0].sessions || 0),
          totalMessages: Number(conversationCounts.rows[0].total_messages || 0),
          userMessages: Number(conversationCounts.rows[0].user_messages || 0),
          aiReplies: Number(conversationCounts.rows[0].ai_replies || 0),
          knowledgeGaps: Number(gapCounts.rows[0].total || 0),
          resolvedGaps: Number(gapCounts.rows[0].resolved || 0),
          manualGaps: Number(gapCounts.rows[0].manual || 0),
          positiveRatings: positive,
          negativeRatings: negative,
          satisfactionRate: ratingTotal > 0 ? Math.round((positive / ratingTotal) * 100) : 0,
        },
        categories: Object.values(categories).sort((a, b) => b.count - a.count),
        gapStatuses: gapStatusCounts.rows.map(row => ({
          status: row.status,
          statusLabel: {
            pending: '待確認',
            resolved: '已解決',
            ignored: '不處理',
            manual: '需人工處理',
          }[row.status] || row.status,
          count: Number(row.count),
          samples: gapRowsByStatus[row.status] || [],
        })),
        knowledge: {
          dbSections: Number(knowledgeCounts.rows[0].count || 0),
          ragChunks: Number(chunkCounts.rows[0].count || 0),
          archivedDuplicates: Number(databasePayload.dedupe_applied?.archived_duplicate_records_total || 0),
          activeDuplicateGroups: Number(auditPayload.summary?.duplicate_groups || 0),
          conflictsPendingReview: Number(auditPayload.summary?.conflicts_pending_review || 0),
        },
      };

      payload.optimizations = [
        { key: 'resolved-gaps', label: '已解決知識缺口', count: payload.summary.resolvedGaps, unit: '則', samples: gapRowsByStatus.resolved || [] },
        { key: 'manual-gaps', label: '需人工處理', count: payload.summary.manualGaps, unit: '則', samples: gapRowsByStatus.manual || [] },
        {
          key: 'archived-duplicates',
          label: '已封存重複知識',
          count: payload.knowledge.archivedDuplicates,
          unit: '筆',
          samples: [{ preview: '重複知識已標記 archived，不再進入 AI 回答知識庫。', note: databasePayload.dedupe_applied?.method || '' }],
        },
        { key: 'pending-conflicts', label: '待確認衝突', count: payload.knowledge.conflictsPendingReview, unit: '筆', samples: conflictItems },
      ];

      payload.reportMarkdown = buildOperationsReportMarkdown(payload);
      res.json(payload);
    } catch (err) {
      console.error('Operations report error:', err.message);
      res.status(500).json({ error: '產生營運報表失敗' });
    }
  });

  return router;
}

module.exports = { createReportsRouter };
