import { api, registerPrincipalProvider, clearCsrfToken } from './api.js';

const STORAGE_KEY_PRINCIPAL = 'devworkspace_active_principal_id';
const STORAGE_KEY_ORG = 'devworkspace_active_org_id';

class AuthService {
  constructor() {
    this.user = null;
    this.principals = [];
    this.clientPrincipals = [];
    this.activePrincipalId = localStorage.getItem(STORAGE_KEY_PRINCIPAL) || null;
    this.activeOrgId = localStorage.getItem(STORAGE_KEY_ORG) || null;
    this.initialized = false;
    this.initPromise = null;

    // Register active principal getter with API client
    registerPrincipalProvider(() => this.getActivePrincipalId());
  }

  getActivePrincipalId() {
    return this.activePrincipalId;
  }

  getActiveOrgId() {
    return this.activeOrgId;
  }

  getAllPrincipals() {
    return [...(this.principals || []), ...(this.clientPrincipals || [])];
  }

  getActivePrincipal() {
    if (!this.activePrincipalId) return null;
    return this.getAllPrincipals().find((p) => p.id === this.activePrincipalId) || null;
  }

  setActivePrincipal(principalId, orgId = null) {
    this.activePrincipalId = principalId;
    if (principalId) {
      localStorage.setItem(STORAGE_KEY_PRINCIPAL, principalId);
    } else {
      localStorage.removeItem(STORAGE_KEY_PRINCIPAL);
    }

    if (orgId) {
      this.activeOrgId = orgId;
      localStorage.setItem(STORAGE_KEY_ORG, orgId);
    } else {
      const match = this.getAllPrincipals().find((p) => p.id === principalId);
      const targetOrg = match?.organizationId || match?.organization_id;
      if (targetOrg) {
        this.activeOrgId = targetOrg;
        localStorage.setItem(STORAGE_KEY_ORG, targetOrg);
      } else {
        this.activeOrgId = null;
        localStorage.removeItem(STORAGE_KEY_ORG);
      }
    }
  }

  clearSession() {
    this.user = null;
    this.principals = [];
    this.clientPrincipals = [];
    this.activePrincipalId = null;
    this.activeOrgId = null;
    this.initialized = false;
    localStorage.removeItem(STORAGE_KEY_PRINCIPAL);
    localStorage.removeItem(STORAGE_KEY_ORG);
    clearCsrfToken();
  }

  async init(force = false) {
    if (this.initialized && !force) {
      return {
        authenticated: Boolean(this.user),
        user: this.user,
        principals: this.principals,
        clientPrincipals: this.clientPrincipals,
        activePrincipal: this.getActivePrincipal()
      };
    }

    if (this.initPromise && !force) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const user = await api.get('/me');
        this.user = user;

        // Fetch organization principals
        try {
          const princData = await api.get('/me/principals');
          this.principals = Array.isArray(princData?.items) ? princData.items : (Array.isArray(princData) ? princData : []);
        } catch (_) {
          this.principals = [];
        }

        // Fetch client principals
        try {
          const clientPrincData = await api.get('/me/client-principals');
          this.clientPrincipals = Array.isArray(clientPrincData?.items) ? clientPrincData.items : (Array.isArray(clientPrincData) ? clientPrincData : []);
        } catch (_) {
          this.clientPrincipals = [];
        }

        // Validate and reconcile active principal against all principals
        const all = this.getAllPrincipals();
        const validPrincipal = all.find((p) => p.id === this.activePrincipalId);
        if (validPrincipal) {
          this.setActivePrincipal(validPrincipal.id, validPrincipal.organizationId || validPrincipal.organization_id);
        } else if (this.principals.length > 0) {
          this.setActivePrincipal(this.principals[0].id, this.principals[0].organizationId || this.principals[0].organization_id);
        } else if (this.clientPrincipals.length > 0) {
          this.setActivePrincipal(this.clientPrincipals[0].id, this.clientPrincipals[0].organizationId || this.clientPrincipals[0].organization_id);
        } else {
          this.setActivePrincipal(null, null);
        }

        this.initialized = true;
        return {
          authenticated: true,
          user: this.user,
          principals: this.principals,
          clientPrincipals: this.clientPrincipals,
          activePrincipal: this.getActivePrincipal()
        };
      } catch (err) {
        this.clearSession();
        this.initialized = true;
        return {
          authenticated: false,
          user: null,
          principals: [],
          clientPrincipals: [],
          activePrincipal: null
        };
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async login(email, password) {
    const res = await api.post('/identity/login', { email, password });
    await this.init(true);
    return {
      res,
      user: this.user,
      principals: this.principals,
      clientPrincipals: this.clientPrincipals,
      activePrincipal: this.getActivePrincipal()
    };
  }

  async register(name, email, password) {
    return api.post('/identity/register', { name, email, password });
  }

  async logout() {
    try {
      await api.post('/identity/logout', {});
    } catch (_) {}
    this.clearSession();
    window.location.href = '/login';
  }

  async verifyEmail(token) {
    return api.post('/identity/verify', { token });
  }

  async requestPasswordReset(email) {
    return api.post('/identity/recovery', { email });
  }

  async resetPassword(token, newPassword) {
    return api.post('/identity/reset', { token, newPassword });
  }

  async inspectInvitation(token) {
    return api.post('/invitations/inspect', { token });
  }

  async acceptInvitation(token) {
    const res = await api.post('/invitations/accept', { token });
    await this.init(true);
    return res;
  }

  async createOrganization({ name, description = '', timezone = null }) {
    const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const org = await api.post('/organizations', {
      name: name.trim(),
      description: description.trim(),
      timezone: tz
    });

    // The backend executes `membership_session_revision()` trigger on bootstrap,
    // which revokes the pre-organization session. Clear local session state so the user
    // can sign in fresh to establish their organization-scoped session.
    this.clearSession();
    return org;
  }
}

export const auth = new AuthService();
export default auth;
