// Client for the SundarSTEM portal API, using the same endpoints and payloads
// as the portal's own translator screens.

export const PORTAL = 'https://virtual.sundarstem.edu.pk';
const API = `${PORTAL}/api`;

export const LANGUAGES = {
  urdu: {
    key: 'urdu',
    label: 'Urdu',
    native: 'اردو',
    textField: 'question_text_urdu',
    stepsField: 'solution_steps_urdu',
    reviewFlag: 'pending_for_urdu_translation_review',
    fontClass: 'font-urdu',
  },
  sindhi: {
    key: 'sindhi',
    label: 'Sindhi',
    native: 'سنڌي',
    textField: 'question_text_sindhi',
    stepsField: 'solution_steps_sindhi',
    reviewFlag: 'pending_for_sindhi_translation_review',
    fontClass: 'font-sindhi',
  },
};

export class SessionExpiredError extends Error {}
export class PortalError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const baseHeaders = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };

async function parse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

export async function login(identifier, password) {
  const res = await fetch(`${API}/login`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await parse(res);
  if (!res.ok || !body?.token) {
    throw new PortalError(body?.message || `Login failed (HTTP ${res.status})`, res.status);
  }
  return { token: body.token, user: body.user };
}

export class PortalClient {
  constructor(token) {
    this.token = token;
  }

  async request(method, path, body) {
    const headers = { ...baseHeaders, Authorization: `Bearer ${this.token}` };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });
    const data = await parse(res);
    if (res.status === 401) {
      throw new SessionExpiredError(data?.message || 'Your session has ended. Please log in again.');
    }
    if (!res.ok || data?.status === false) {
      throw new PortalError(data?.message || `Request failed (HTTP ${res.status})`, res.status);
    }
    return data;
  }

  me() {
    return this.request('GET', '/me').then((d) => d.user ?? d.data ?? d);
  }

  async getQuestion(id) {
    const d = await this.request('GET', `/questions/${encodeURIComponent(id)}`);
    return d?.data?.question ?? d?.data ?? d;
  }

  /** One page of the translator question list. params: [[key, value], ...] (repeat keys for arrays). */
  async listQuestions(params) {
    const qs = new URLSearchParams(params);
    const d = await this.request('GET', `/translator/questions?${qs}`);
    const page = d?.data ?? {};
    return {
      questions: Array.isArray(page.data) ? page.data : [],
      lastPage: page.last_page ?? 1,
      total: page.total ?? 0,
      filters: page.filters ?? d?.filters ?? {},
    };
  }

  /** Filter options the portal offers (units, subjects, classes, ...). */
  async filterOptions() {
    const { filters } = await this.listQuestions([['page', 1], ['per_page', 1]]);
    const opts = filters?.options ?? {};
    const values = (list) => [...new Set((list ?? []).map((o) => o?.value ?? o).filter(Boolean))];
    return { units: values(opts.unit), subjects: values(opts.subject), grades: values(opts.grade) };
  }

  /**
   * All questions of one unit that still need translation in `language`
   * (pending or rejected). The portal's unit filter is used on the server;
   * class and subject are checked here because the portal's own subject/class
   * filters don't combine with it.
   */
  async questionsForUnit(portalUnit, language, onPage) {
    const all = [];
    let page = 1;
    let lastPage = 1;
    do {
      const res = await this.listQuestions([
        ['page', page],
        ['per_page', 100],
        ['unit[]', portalUnit],
        ['translation_status[]', `pending_${language}_translation`],
        ['translation_status[]', `${language}_rejected`],
      ]);
      all.push(...res.questions);
      lastPage = res.lastPage;
      onPage?.(page, lastPage);
      page++;
    } while (page <= lastPage);
    return all;
  }

  async submitTranslation(id, form) {
    return this.request('POST', `/translator/questions/${encodeURIComponent(id)}/submit`, form);
  }
}

export function translationStatus(question, language) {
  return (
    question?.translation_statuses?.[language] ??
    question?.[`${language}_translation_status`] ??
    null
  );
}

/** Statuses a translator can still work on. */
export function isTranslatable(status) {
  return status === 'pending_translation' || status === 'rejected' || status == null;
}

export function rejectionComment(question, language) {
  return question?.translation_rejection_comments?.[language] ?? null;
}

export function imageUrl(path) {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${PORTAL}/storage/${String(path).replace(/^\/+/, '')}`;
}

/** Download a portal image so it can be re-uploaded with the translation. */
export async function fetchImageFile(path) {
  const url = imageUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new PortalError(`Could not download image ${url} (HTTP ${res.status})`, res.status);
  const blob = await res.blob();
  const name = String(path).split('/').pop() || 'image.png';
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/**
 * Build the multipart body the portal's translator "Send" button posts.
 * steps: [{ html, images: File[] }]
 */
export function buildSubmitForm(language, questionHtml, steps) {
  const lang = LANGUAGES[language];
  if (!lang) throw new Error(`Unknown language ${language}`);
  const form = new FormData();
  form.append(lang.reviewFlag, true);
  form.append(`translation_statuses[${language}]`, 'pending_review');
  form.append(lang.textField, questionHtml || '');
  steps.forEach((step, i) => {
    form.append(`${lang.stepsField}[${i}][explanation]`, step.html || '');
    const files = (step.images ?? []).filter((f) => f instanceof Blob);
    if (files.length) {
      files.forEach((f) => form.append(`${lang.stepsField}[${i}][images][]`, f, f.name));
    } else {
      form.append(`${lang.stepsField}[${i}][images]`, '');
    }
  });
  return form;
}
