const db = require('../db');
const authService = require('../services/auth.service');
const { setAdminCookie, clearAdminCookie } = require('../middleware/csrf');
const { safeClientMessage } = require('../utils/safeError');
const {
  CAPTCHA_COOKIE,
  createCaptcha,
  verifyCaptcha,
  readCaptcha,
  captchaCookieOptions,
  renderCaptchaSvg,
  renderCaptchaWav,
} = require('../utils/captcha');

function flashRedirect(res, path, type, message) {
  const q = type === 'error' ? 'error' : 'flash';
  return res.redirect(`${path}?${q}=${encodeURIComponent(message)}`);
}

function pageLocals(req, extra = {}) {
  return {
    admin: req.admin,
    flash: req.query.flash || null,
    error: req.query.error || null,
    activeMenu: extra.activeMenu || 'dashboard',
    pageTitle: extra.pageTitle || 'Dashboard',
    ...extra,
  };
}

function issueLoginCaptcha(req, res) {
  const captcha = createCaptcha();
  res.cookie(CAPTCHA_COOKIE, captcha.token, captchaCookieOptions(req));
  return captcha;
}

function renderLoginView(req, res, { error = null } = {}) {
  const captcha = issueLoginCaptcha(req, res);
  const captchaSvg = String(captcha.svg).replace(/^<\?xml[^>]*>\s*/i, '');
  return res.render('admin/login', {
    error,
    csrfToken: res.locals.csrfToken || null,
    captchaSvg,
  });
}

function renderLogin(req, res) {
  if (req.cookies?.admin_session) {
    try {
      authService.verifyAdminSession(req.cookies.admin_session);
      return res.redirect('/admin');
    } catch {
      clearAdminCookie(req, res);
    }
  }
  return renderLoginView(req, res, { error: req.query.error || null });
}

async function postLogin(req, res) {
  const { username, password, captcha } = req.body || {};
  const captchaToken = req.cookies?.[CAPTCHA_COOKIE];

  if (!verifyCaptcha(captchaToken, captcha)) {
    res.status(400);
    return renderLoginView(req, res, {
      error: 'Captcha salah atau kedaluwarsa. Coba lagi.',
    });
  }

  const user = await authService.loginAdmin(username, password);
  if (!user) {
    res.status(401);
    return renderLoginView(req, res, {
      error: 'Invalid username or password',
    });
  }

  res.clearCookie(CAPTCHA_COOKIE, { path: '/admin' });
  const token = authService.signAdminSession(user);
  setAdminCookie(req, res, token);
  return res.redirect('/admin');
}

function captchaImage(req, res) {
  const token = req.cookies?.[CAPTCHA_COOKIE];
  const payload = readCaptcha(token);
  if (!payload) {
    const captcha = issueLoginCaptcha(req, res);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(captcha.svg);
  }
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(renderCaptchaSvg(payload.code));
}

function captchaAudio(req, res) {
  const token = req.cookies?.[CAPTCHA_COOKIE];
  const payload = readCaptcha(token);
  if (!payload) {
    const captcha = issueLoginCaptcha(req, res);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(captcha.wav);
  }
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'no-store');
  return res.send(renderCaptchaWav(payload.code));
}

function captchaRefresh(req, res) {
  const captcha = issueLoginCaptcha(req, res);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    status: 'success',
    data: {
      svg: String(captcha.svg).replace(/^<\?xml[^>]*>\s*/i, ''),
    },
  });
}

function logout(req, res) {
  clearAdminCookie(req, res);
  return res.redirect('/admin/login');
}

async function dashboard(req, res, next) {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const [counts, settings, usage] = await Promise.all([
      db.getDashboardCounts(),
      db.getAllSettings(),
      db.getUsageAnalytics({ days }),
    ]);
    const pricingService = require('../services/pricing.service');
    return res.render(
      'admin/dashboard',
      pageLocals(req, {
        activeMenu: 'dashboard',
        pageTitle: 'Dashboard',
        counts,
        settings,
        usage,
        days,
        formatUsd: pricingService.formatUsd,
        formatIdr: pricingService.formatIdr,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/* ===================== USERS ===================== */
async function usersList(req, res, next) {
  try {
    const users = await db.listUsers();
    return res.render(
      'admin/users/list',
      pageLocals(req, { activeMenu: 'users', pageTitle: 'Users', users })
    );
  } catch (err) {
    return next(err);
  }
}

function usersCreateForm(req, res) {
  return res.render(
    'admin/users/form',
    pageLocals(req, {
      activeMenu: 'users',
      pageTitle: 'Add User',
      mode: 'create',
      user: { username: '', role: 'api', is_active: true },
    })
  );
}

async function usersCreate(req, res) {
  const { username, password, role } = req.body || {};
  if (!username || !password || !role) {
    return flashRedirect(res, '/admin/users/create', 'error', 'All fields are required');
  }
  try {
    await db.createUser(String(username).trim(), String(password), role);
    return flashRedirect(res, '/admin/users', 'flash', `User ${username} created`);
  } catch (err) {
    return flashRedirect(
      res,
      '/admin/users/create',
      'error',
      safeClientMessage(err, 'Failed to create user')
    );
  }
}

async function usersEditForm(req, res, next) {
  try {
    const user = await db.findUserById(Number(req.params.id));
    if (!user) return flashRedirect(res, '/admin/users', 'error', 'User not found');
    return res.render(
      'admin/users/form',
      pageLocals(req, {
        activeMenu: 'users',
        pageTitle: 'Edit User',
        mode: 'edit',
        user,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function usersUpdate(req, res) {
  const id = Number(req.params.id);
  const { username, role, is_active, password } = req.body || {};
  try {
    await db.updateUser(id, {
      username: String(username || '').trim(),
      role,
      is_active: is_active === '1' || is_active === 'true' || is_active === 'on',
    });
    if (password && String(password).trim()) {
      await db.updateUserPassword(id, String(password));
    }
    return flashRedirect(res, '/admin/users', 'flash', 'User updated');
  } catch (err) {
    return flashRedirect(
      res,
      `/admin/users/${id}/edit`,
      'error',
      safeClientMessage(err, 'Failed to update user')
    );
  }
}

async function usersDelete(req, res) {
  const id = Number(req.params.id);
  try {
    if (req.admin?.uid && Number(req.admin.uid) === id) {
      return flashRedirect(res, '/admin/users', 'error', 'Cannot delete your own account');
    }
    await db.deleteUser(id);
    return flashRedirect(res, '/admin/users', 'flash', 'User deleted');
  } catch (err) {
    return flashRedirect(res, '/admin/users', 'error', safeClientMessage(err, 'Failed to delete user'));
  }
}

/* ===================== WHITELIST ===================== */
async function whitelistList(req, res, next) {
  try {
    const ips = await db.listWhitelistIps();
    const settings = await db.getAllSettings();
    return res.render(
      'admin/whitelist/list',
      pageLocals(req, {
        activeMenu: 'whitelist',
        pageTitle: 'IP Whitelist',
        ips,
        whitelistEnabled: settings.ip_whitelist_enabled === 'true',
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function whitelistCreateForm(req, res, next) {
  try {
    const apiUsers = await db.listApiUsers();
    return res.render(
      'admin/whitelist/form',
      pageLocals(req, {
        activeMenu: 'whitelist',
        pageTitle: 'Add IP Whitelist',
        mode: 'create',
        apiUsers,
        row: { user_id: '', ip: '', label: '' },
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function whitelistCreate(req, res) {
  const { user_id, ip, label } = req.body || {};
  if (!user_id || !ip) {
    return flashRedirect(res, '/admin/whitelist/create', 'error', 'API user and IP required');
  }
  try {
    await db.addWhitelistIp(Number(user_id), String(ip).trim(), label || '');
    return flashRedirect(res, '/admin/whitelist', 'flash', 'IP added');
  } catch (err) {
    return flashRedirect(res, '/admin/whitelist/create', 'error', err.message);
  }
}

async function whitelistEditForm(req, res, next) {
  try {
    const row = await db.getWhitelistById(Number(req.params.id));
    if (!row) return flashRedirect(res, '/admin/whitelist', 'error', 'IP not found');
    const apiUsers = await db.listApiUsers();
    return res.render(
      'admin/whitelist/form',
      pageLocals(req, {
        activeMenu: 'whitelist',
        pageTitle: 'Edit IP Whitelist',
        mode: 'edit',
        apiUsers,
        row,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function whitelistUpdate(req, res) {
  const id = Number(req.params.id);
  const { user_id, ip, label } = req.body || {};
  try {
    await db.updateWhitelistIp(id, Number(user_id), String(ip).trim(), label || '');
    return flashRedirect(res, '/admin/whitelist', 'flash', 'IP updated');
  } catch (err) {
    return flashRedirect(res, `/admin/whitelist/${id}/edit`, 'error', err.message);
  }
}

async function whitelistDelete(req, res) {
  try {
    await db.removeWhitelistIp(Number(req.params.id));
    return flashRedirect(res, '/admin/whitelist', 'flash', 'IP deleted');
  } catch (err) {
    return flashRedirect(res, '/admin/whitelist', 'error', err.message);
  }
}

/* ===================== TOKENS ===================== */
async function tokensList(req, res, next) {
  try {
    const tokens = await db.listApiTokens();
    return res.render(
      'admin/tokens/list',
      pageLocals(req, {
        activeMenu: 'tokens',
        pageTitle: 'API Tokens',
        tokens,
        newToken: req.query.newToken || null,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function tokensCreateForm(req, res, next) {
  try {
    const apiUsers = await db.listApiUsers();
    return res.render(
      'admin/tokens/form',
      pageLocals(req, {
        activeMenu: 'tokens',
        pageTitle: 'Create API Token',
        mode: 'create',
        apiUsers,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function tokensCreate(req, res) {
  const userId = Number(req.body?.user_id);
  const name = (req.body?.name || '').trim() || 'API Token';
  if (!userId) {
    return flashRedirect(res, '/admin/tokens/create', 'error', 'Select an API user');
  }
  try {
    const created = await authService.createStaticApiToken(userId, name);
    return res.redirect(
      `/admin/tokens?flash=${encodeURIComponent('Token created — copy now')}&newToken=${encodeURIComponent(created.token)}`
    );
  } catch (err) {
    return flashRedirect(res, '/admin/tokens/create', 'error', err.message);
  }
}

async function tokensRevoke(req, res) {
  try {
    await db.revokeApiToken(Number(req.params.id));
    return flashRedirect(res, '/admin/tokens', 'flash', 'Token revoked');
  } catch (err) {
    return flashRedirect(res, '/admin/tokens', 'error', err.message);
  }
}

async function tokensDelete(req, res) {
  try {
    await db.deleteApiToken(Number(req.params.id));
    return flashRedirect(res, '/admin/tokens', 'flash', 'Token deleted');
  } catch (err) {
    return flashRedirect(res, '/admin/tokens', 'error', err.message);
  }
}

/* ===================== SETTINGS ===================== */
async function settingsPage(req, res, next) {
  try {
    const settings = await db.getAllSettings();
    const rawKey = settings.openai_api_key || '';
    const hasOpenAiKey = Boolean(rawKey.trim());
    const openAiKeyHint = hasOpenAiKey
      ? `••••••••${rawKey.trim().slice(-4)}`
      : '';
    const rawOllamaKey = settings.ollama_api_key || '';
    const hasOllamaKey = Boolean(rawOllamaKey.trim());
    const ollamaKeyHint = hasOllamaKey
      ? `••••••••${rawOllamaKey.trim().slice(-4)}`
      : '';
    return res.render(
      'admin/settings/index',
      pageLocals(req, {
        activeMenu: 'settings',
        pageTitle: 'Settings',
        settings,
        hasOpenAiKey,
        openAiKeyHint,
        hasOllamaKey,
        ollamaKeyHint,
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function settingsUpdate(req, res) {
  try {
    const allowed = [
      'ai_provider',
      'openai_model',
      'openai_image_model',
      'openai_image_size',
      'ollama_base_url',
      'ollama_model',
      'temperature',
      'max_tokens',
      'system_prompt',
      'max_upload_mb',
      'allowed_file_types',
      'ip_whitelist_enabled',
      'openai_price_prompt_per_1m_usd',
      'openai_price_completion_per_1m_usd',
      'usd_to_idr',
      'openai_image_price_usd',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        let value = req.body[key];
        if (key === 'ip_whitelist_enabled') {
          value = value === 'true' || value === 'on' ? 'true' : 'false';
        }
        if (key === 'ai_provider') {
          value = String(value).toLowerCase() === 'ollama' ? 'ollama' : 'openai';
        }
        if (key === 'allowed_file_types') {
          const fileService = require('../services/file.service');
          const list = fileService.normalizeAllowedTypes(value);
          value = list.length ? list.join(',') : 'pdf,docx,txt';
        }
        if (
          [
            'openai_price_prompt_per_1m_usd',
            'openai_price_completion_per_1m_usd',
            'usd_to_idr',
            'openai_image_price_usd',
          ].includes(key)
        ) {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) {
            return flashRedirect(
              res,
              '/admin/settings',
              'error',
              `Invalid number for ${key}`
            );
          }
          value = String(n);
        }
        await db.setSetting(key, value);
      }
    }

    if (req.body.ip_whitelist_enabled === undefined) {
      await db.setSetting('ip_whitelist_enabled', 'false');
    }

    const newOpenAiKey = String(req.body.openai_api_key || '').trim();
    if (newOpenAiKey) {
      await db.setSetting('openai_api_key', newOpenAiKey);
    }

    const newOllamaKey = String(req.body.ollama_api_key || '').trim();
    if (newOllamaKey) {
      await db.setSetting('ollama_api_key', newOllamaKey);
    }

    return flashRedirect(res, '/admin/settings', 'flash', 'Settings saved');
  } catch (err) {
    return flashRedirect(res, '/admin/settings', 'error', err.message);
  }
}

/* ===================== AI LOGS ===================== */
async function logsList(req, res, next) {
  try {
    return res.render(
      'admin/logs/list',
      pageLocals(req, {
        activeMenu: 'logs',
        pageTitle: 'AI Logs',
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function logsData(req, res, next) {
  try {
    const draw = Number(req.query.draw) || 1;
    const start = Math.max(0, Number(req.query.start) || 0);
    const length = Math.min(100, Math.max(1, Number(req.query.length) || 10));
    const search = req.query.search?.value || '';

    const orderIdx = Number(req.query.order?.[0]?.column ?? 0);
    const orderDir = req.query.order?.[0]?.dir || 'desc';
    const orderMap = [
      'id',
      'created_at',
      'username',
      'id', // prompt preview — fallback id
      'file_name',
      'response_status',
      'model',
      'total_tokens',
      'cost_usd',
      'id',
    ];
    const orderColumn = orderMap[orderIdx] || 'id';

    const [recordsTotal, recordsFiltered, rows] = await Promise.all([
      db.countExtractLogs(''),
      db.countExtractLogs(search),
      db.listExtractLogs({
        limit: length,
        offset: start,
        search,
        orderColumn,
        orderDir,
      }),
    ]);

    const pricingService = require('../services/pricing.service');
    const pricing = await pricingService.getTokenPricing();

    const data = rows.map((row) => {
      const tokenLabel =
        row.auth_type === 'static'
          ? `${row.token_name || 'token'} · ${(row.token_prefix || '')}...`
          : row.auth_type === 'admin_chat'
            ? `Admin Chat${row.schema_hint && String(row.schema_hint).includes('image') ? ' · image' : ''}`
            : 'JWT';
      const prompt =
        (row.prompt_preview || '-') +
        (row.prompt_preview && row.prompt_preview.length >= 120 ? '…' : '');

      const hasFile = row.has_file === true || row.has_file === 1 || row.has_file === 'true';
      let fileHtml = '<span class="text-muted">—</span>';
      if (hasFile) {
        let label = 'file';
        let count = 1;
        try {
          const info = JSON.parse(row.file_name || '{}');
          if (Array.isArray(info.uploads) || Array.isArray(info.generated)) {
            const uploadNames = (info.uploads || []).map((f) => f.name || f.file_name).filter(Boolean);
            const genNames = (info.generated || []).map((f) => f.fileName || f.url).filter(Boolean);
            count = uploadNames.length + genNames.length || 1;
            label = [...uploadNames, ...genNames].join(', ') || `${count} file(s)`;
          } else {
            const names = (info.files || []).map((f) => f.file_name).filter(Boolean);
            const urls = info.urls || [];
            count = names.length || urls.length || 1;
            label = names.length ? names.join(', ') : urls.map((u) => String(u).split('/').pop()).join(', ');
            if (!label) label = `${count} file(s)`;
          }
        } catch {
          label = String(row.file_name || 'file').slice(0, 60);
        }
        fileHtml = `<span class="badge text-bg-info">${count} file(s)</span> <span class="small">${escapeHtml(String(label).slice(0, 80))}</span>`;
      }

      const statusHtml =
        row.response_status === 'success'
          ? '<span class="badge text-bg-success">success</span>'
          : `<span class="badge text-bg-danger">${escapeHtml(row.response_status || 'error')}</span>`;
      const actionHtml = `<a class="btn btn-sm btn-light-primary" href="/admin/logs/${row.id}">View</a>`;

      let costUsd = row.cost_usd != null ? Number(row.cost_usd) : null;
      let costIdr = row.cost_idr != null ? Number(row.cost_idr) : null;
      if (costUsd == null) {
        const est = pricingService.computeTokenCost(
          {
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
            schemaHint: row.schema_hint,
            responseStatus: row.response_status,
          },
          pricing
        );
        costUsd = est.costUsd;
        costIdr = est.costIdr;
      } else if (costIdr == null) {
        costIdr = costUsd * pricing.usdToIdr;
      }

      const costHtml = `<span class="small d-block">${escapeHtml(pricingService.formatUsd(costUsd))}</span><span class="small text-muted">${escapeHtml(pricingService.formatIdr(costIdr))}</span>`;

      return [
        row.id,
        formatDate(row.created_at),
        `<div class="fw-semibold">${escapeHtml(row.username || '-')}</div><div class="small text-muted">${escapeHtml(tokenLabel)}</div>`,
        `<span class="small">${escapeHtml(prompt)}</span>`,
        fileHtml,
        statusHtml,
        `<span class="small">${escapeHtml(row.model || '-')}</span>`,
        `<span class="small">${row.total_tokens != null ? row.total_tokens : '-'}</span>`,
        costHtml,
        actionHtml,
      ];
    });

    return res.json({
      draw,
      recordsTotal,
      recordsFiltered,
      data,
    });
  } catch (err) {
    return next(err);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

async function logsDetail(req, res, next) {
  try {
    const log = await db.getExtractLogById(Number(req.params.id));
    if (!log) return flashRedirect(res, '/admin/logs', 'error', 'Log not found');
    const pricingService = require('../services/pricing.service');
    const pricing = await pricingService.getTokenPricing();
    let costUsd = log.cost_usd != null ? Number(log.cost_usd) : null;
    let costIdr = log.cost_idr != null ? Number(log.cost_idr) : null;
    if (costUsd == null) {
      const est = pricingService.computeTokenCost(
        {
          promptTokens: log.prompt_tokens,
          completionTokens: log.completion_tokens,
          schemaHint: log.schema_hint,
          responseStatus: log.response_status,
        },
        pricing
      );
      costUsd = est.costUsd;
      costIdr = est.costIdr;
    } else if (costIdr == null) {
      costIdr = costUsd * pricing.usdToIdr;
    }
    return res.render(
      'admin/logs/detail',
      pageLocals(req, {
        activeMenu: 'logs',
        pageTitle: `AI Log #${log.id}`,
        log,
        costUsd,
        costIdr,
        formatUsd: pricingService.formatUsd,
        formatIdr: pricingService.formatIdr,
        pricing,
      })
    );
  } catch (err) {
    return next(err);
  }
}

/* ===================== CHAT ===================== */
async function chatPage(req, res, next) {
  try {
    const settings = await db.getAllSettings();
    const provider = settings.ai_provider || 'openai';
    const model =
      provider === 'ollama'
        ? settings.ollama_model || '-'
        : settings.openai_model || '-';
    const fileService = require('../services/file.service');
    const allowedTypes = await fileService.getAllowedExtensions();
    const acceptAttr = allowedTypes
      .map((ext) => `.${ext}`)
      .concat(
        allowedTypes.includes('pdf') ? ['application/pdf'] : [],
        allowedTypes.some((e) => ['jpg', 'jpeg'].includes(e)) ? ['image/jpeg'] : [],
        allowedTypes.includes('png') ? ['image/png'] : []
      )
      .join(',');
    return res.render(
      'admin/chat/index',
      pageLocals(req, {
        activeMenu: 'chat',
        pageTitle: 'AI Chat',
        provider,
        model,
        allowedTypes,
        acceptAttr: acceptAttr || '.pdf,.docx,.txt',
      })
    );
  } catch (err) {
    return next(err);
  }
}

async function chatMessage(req, res) {
  const chatService = require('../services/chat.service');
  const fileService = require('../services/file.service');
  const started = Date.now();
  const ip = req.clientIp || req.ip;
  const requestId = req.requestId || null;

  const message = String(req.body?.message || '').trim();
  let history = [];
  try {
    history = JSON.parse(req.body?.history || '[]');
    if (!Array.isArray(history)) history = [];
  } catch {
    history = [];
  }

  const uploads = Array.isArray(req.files) ? req.files : [];
  const forceImage =
    String(req.body?.generate_image || '').toLowerCase() === 'true' ||
    String(req.body?.generate_image || '') === '1';
  const forcePdf =
    String(req.body?.generate_pdf || '').toLowerCase() === 'true' ||
    String(req.body?.generate_pdf || '') === '1';

  async function saveChatLog(payload) {
    try {
      await db.createExtractLog({
        requestId,
        userId: req.admin?.uid ?? null,
        username: req.admin?.sub || null,
        authType: 'admin_chat',
        tokenId: null,
        tokenName: 'Admin Chat',
        tokenPrefix: 'chat',
        ip,
        ...payload,
      });
    } catch (err) {
      console.error('Failed to save chat log:', err.message);
    }
  }

  try {
    if (!message && uploads.length === 0) {
      await saveChatLog({
        prompt: message || '',
        schemaHint: 'admin_chat',
        hasFile: false,
        fileName: null,
        fileSize: null,
        fileText: null,
        aiResponse: null,
        responseStatus: 'error',
        httpStatus: 400,
        durationMs: Date.now() - started,
        errorMessage: 'message or file is required',
      });
      return res.status(400).json({
        status: 'error',
        data: null,
        message: 'message or file is required',
      });
    }

    const processed = await chatService.processChatUploads(uploads);
    const result = await chatService.chat({
      message: message || 'Please analyze the attached file(s).',
      history: history.slice(-20),
      fileText: processed.fileText,
      visionFiles: processed.visionFiles,
      imageFiles: processed.imageFiles || [],
      forceImage: forceImage && !forcePdf,
      forcePdf,
    });

    const usage = result.meta?.usage || {};
    const images = result.images || [];
    const documents = result.documents || [];
    const mode =
      result.meta?.mode ||
      (forcePdf ? 'pdf_generation' : forceImage ? 'image_generation' : 'chat');
    const aiResponse = JSON.stringify({
      reply: result.reply,
      images,
      documents,
      meta: result.meta || null,
    });

    await saveChatLog({
      prompt: message || '(file only)',
      schemaHint: `admin_chat:${mode}`,
      hasFile:
        processed.filesMeta.length > 0 || images.length > 0 || documents.length > 0,
      fileName:
        processed.filesMeta.length || images.length || documents.length
          ? JSON.stringify({
              uploads: processed.filesMeta,
              generated: images,
              documents,
            })
          : null,
      fileSize: processed.filesMeta.reduce((sum, f) => sum + (Number(f.size) || 0), 0) || null,
      fileText: processed.fileText || null,
      aiResponse,
      model: result.meta?.model || null,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null,
      responseStatus: 'success',
      httpStatus: 200,
      durationMs: Date.now() - started,
      errorMessage: null,
    });

    return res.json({
      status: 'success',
      data: {
        reply: result.reply,
        images,
        documents,
        files: processed.filesMeta,
        meta: result.meta,
      },
    });
  } catch (err) {
    for (const f of req.files || []) {
      try {
        fileService.safeUnlink(f.path);
      } catch {
        // ignore
      }
    }
    console.error('Admin chat error:', err);
    const status =
      err.code === 'OPENAI_NOT_CONFIGURED' ||
      err.code === 'OLLAMA_NOT_CONFIGURED' ||
      err.code === 'IMAGE_PROVIDER_UNSUPPORTED'
        ? 503
        : 400;

    await saveChatLog({
      prompt: message || '(file only)',
      schemaHint: forcePdf
        ? 'admin_chat:pdf_generation'
        : forceImage
          ? 'admin_chat:image_generation'
          : 'admin_chat:chat',
      hasFile: uploads.length > 0,
      fileName: uploads.length
        ? JSON.stringify({
            uploads: uploads.map((f) => ({
              name: f.originalname,
              size: f.size,
            })),
          })
        : null,
      fileSize: uploads.reduce((sum, f) => sum + (Number(f.size) || 0), 0) || null,
      fileText: null,
      aiResponse: null,
      model: null,
      responseStatus: 'error',
      httpStatus: status,
      durationMs: Date.now() - started,
      errorMessage: err.message || 'Chat failed',
    });

    return res.status(status).json({
      status: 'error',
      data: null,
      message: err.message || 'Chat failed',
    });
  }
}

/* ===================== ACCOUNT ===================== */
function changePasswordPage(req, res) {
  return res.render(
    'admin/account/password',
    pageLocals(req, {
      activeMenu: 'password',
      pageTitle: 'Change Password',
    })
  );
}

async function changePassword(req, res) {
  const { current_password, new_password, confirm_password } = req.body || {};
  const redirectTo = '/admin/account/password';

  if (!current_password || !new_password || !confirm_password) {
    return flashRedirect(res, redirectTo, 'error', 'Semua field wajib diisi');
  }
  if (String(new_password).length < 8) {
    return flashRedirect(res, redirectTo, 'error', 'Password baru minimal 8 karakter');
  }
  if (String(new_password) !== String(confirm_password)) {
    return flashRedirect(res, redirectTo, 'error', 'Konfirmasi password tidak cocok');
  }
  if (String(current_password) === String(new_password)) {
    return flashRedirect(res, redirectTo, 'error', 'Password baru harus berbeda dari password lama');
  }

  try {
    const userId = req.admin.uid;
    const user = await db.findUserById(userId);
    if (!user || user.role !== 'admin' || !user.is_active) {
      return flashRedirect(res, redirectTo, 'error', 'Akun admin tidak valid');
    }

    const { comparePassword } = require('../utils/password');
    const ok = await comparePassword(
      String(current_password),
      user.password_hash,
      user.password_salt || null
    );
    if (!ok) {
      return flashRedirect(res, redirectTo, 'error', 'Password saat ini salah');
    }

    await db.updateUserPassword(userId, String(new_password));
    return flashRedirect(res, redirectTo, 'flash', 'Password berhasil diganti');
  } catch (err) {
    return flashRedirect(
      res,
      redirectTo,
      'error',
      safeClientMessage(err, 'Gagal ganti password')
    );
  }
}

module.exports = {
  renderLogin,
  postLogin,
  captchaImage,
  captchaAudio,
  captchaRefresh,
  logout,
  dashboard,
  usersList,
  usersCreateForm,
  usersCreate,
  usersEditForm,
  usersUpdate,
  usersDelete,
  whitelistList,
  whitelistCreateForm,
  whitelistCreate,
  whitelistEditForm,
  whitelistUpdate,
  whitelistDelete,
  tokensList,
  tokensCreateForm,
  tokensCreate,
  tokensRevoke,
  tokensDelete,
  settingsPage,
  settingsUpdate,
  changePasswordPage,
  changePassword,
  logsList,
  logsData,
  logsDetail,
  chatPage,
  chatMessage,
};
