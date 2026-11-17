// ==============================================================================
// KANNADA RIDERS GARAGE 14 — Central Client-Side Framework & Realtime Bridge
// ==============================================================================

const API = {
  BASE: '/api',

  async request(method, path, body = null) {
    const opts = {
      method,
      credentials: 'include',
    };
    if (body) {
      if (body instanceof FormData) {
        opts.body = body;
      } else {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
    }

    try {
      const res = await fetch(this.BASE + path, opts);
      const json = await res.json().catch(() => ({}));

      // Find primary array payload if any
      const listKey = Object.keys(json).find(k => Array.isArray(json[k]));

      if (listKey && Array.isArray(json[listKey])) {
        // Return array with meta properties attached so array methods (.map, .slice, .length) WORK
        // AND destructuring { ok, data } ALSO works!
        const arr = [...json[listKey]];
        arr.ok = res.ok;
        arr.status = res.status;
        arr.data = json;
        arr.success = json.success;
        Object.assign(arr, json);
        return arr;
      }

      // If json is directly an array
      if (Array.isArray(json)) {
        const arr = [...json];
        arr.ok = res.ok;
        arr.status = res.status;
        arr.data = json;
        arr.success = true;
        return arr;
      }

      // Normal object return (e.g., stats or auth/me)
      const resObj = {
        ok: res.ok,
        status: res.status,
        data: json,
        success: json.success,
        ...json,
        ...(json.user || {}),
        ...(json.stats || {}),
      };

      return resObj;
    } catch (err) {
      console.error('API Network Error:', err);
      const errObj = { ok: false, status: 0, data: { success: false, message: 'Network connection error.' }, success: false };
      return errObj;
    }
  },

  get(path)           { return this.request('GET', path); },
  post(path, body)    { return this.request('POST', path, body); },
  put(path, body)     { return this.request('PUT', path, body); },
  delete(path)        { return this.request('DELETE', path); },
};

// ─── Real-Time Socket.IO Bridge ───────────────────────────────────────────────
const Realtime = {
  socket: null,
  init(role = 'customer', customerId = null) {
    if (typeof io !== 'undefined') {
      try {
        this.socket = io();
        this.socket.on('connect', () => {
          this.socket.emit('join_portal', { role, customerId });
        });
        return this.socket;
      } catch (e) {
        console.warn('Realtime socket connection could not be established:', e);
      }
    }
    return null;
  },
  on(event, handler) {
    if (this.socket) {
      this.socket.on(event, handler);
    }
  }
};

// ─── Toast Notification System ────────────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(message, type = 'success', duration = 4000) {
    if (!this.container) this.init();
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: '🔔' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span style="font-size:1.1rem;">${icons[type] || '🔔'}</span><div style="flex:1;">${message}</div>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); }
};

// ─── Authentication Utilities ─────────────────────────────────────────────────
const Auth = {
  async logout() {
    try {
      await API.post('/auth/logout');
    } catch(e) {}
    window.location.href = '/';
  },

  async checkAuth(requiredRole) {
    try {
      const res = await API.get('/auth/me');
      const user = res.user || (res.data ? res.data.user : null) || res;
      if (!res.ok || !user || !user.role) {
        window.location.href = requiredRole === 'admin' ? '/admin/login' : '/user/login';
        return null;
      }
      if (user.role !== requiredRole) {
        window.location.href = user.role === 'admin' ? '/admin/dashboard' : '/user/dashboard';
        return null;
      }
      return user;
    } catch(e) {
      window.location.href = requiredRole === 'admin' ? '/admin/login' : '/user/login';
      return null;
    }
  },
};

// ─── Form Utilities ───────────────────────────────────────────────────────────
const FormUtils = {
  setLoading(btn, loading = true, customText = 'Processing...') {
    if (loading) {
      btn._text = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ${customText}`;
    } else {
      btn.disabled = false;
      btn.innerHTML = btn._text || 'Submit';
    }
  },

  showAlert(el, msg, type = 'error') {
    el.className = `alert alert-${type} show`;
    el.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span><span>${msg}</span>`;
  },

  hideAlert(el) {
    el.classList.remove('show');
  },

  serializeForm(form) {
    const data = {};
    new FormData(form).forEach((val, key) => { data[key] = val; });
    return data;
  },
};

// ─── Formatting Utilities ─────────────────────────────────────────────────────
const Format = {
  currency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
  },
  date(str) {
    if (!str) return '—';
    try {
      return new Date(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch(e) { return str; }
  },
  datetime(str) {
    if (!str) return '—';
    try {
      return new Date(str).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch(e) { return str; }
  },
  badge(status) {
    if (!status) return '<span class="badge badge-draft">draft</span>';
    const cls = status.toLowerCase().replace(/\s+/g, '_');
    return `<span class="badge badge-${cls}">${status.replace(/_/g,' ')}</span>`;
  },
};

// ─── Modal Utilities ──────────────────────────────────────────────────────────
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('show'); document.body.style.overflow = 'hidden'; }
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('show'); document.body.style.overflow = ''; }
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay.show, .modal-backdrop.show').forEach(m => m.classList.remove('show'));
    document.body.style.overflow = '';
  },
};

// Global click listeners
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal-backdrop')) {
    Modal.closeAll();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') Modal.closeAll();
});

// Password Show/Hide Toggle
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-toggle-password]');
  if (!btn) return;
  const target = document.getElementById(btn.dataset.togglePassword);
  if (!target) return;
  const isText = target.type === 'text';
  target.type = isText ? 'password' : 'text';
  btn.textContent = isText ? '👁' : '🙈';
});

Toast.init();
