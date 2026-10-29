import pg from 'pg';

const NEON_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_IJB5rdY7VLUN@ep-super-brook-b5yiw42t-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require';

let pool = null;
function getPool() {
  if (!pool && NEON_URL) {
    try {
      pool = new pg.Pool({
        connectionString: NEON_URL,
        max: 3,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false }
      });
      pool.on('error', (err) => console.warn('Pool warning:', err.message));
    } catch (e) {
      console.warn('Failed to initialize pg pool:', e.message);
    }
  }
  return pool;
}

// In-memory data store with full pre-seeded agency data
const state = {
  user: {
    id: 'usr-demo-owner',
    name: 'Demo Agency Owner',
    email: 'demo@agency.com',
    role: 'OWNER',
    active: true,
    emailVerified: true,
    revision: 1
  },
  org: {
    id: 'b302b283-25e2-4484-a981-c2677ac4497f',
    name: 'Studio Velocity',
    description: 'Digital Delivery & Creative Production Agency',
    timezone: 'UTC',
    revision: 1
  },
  principal: {
    id: '320699ce-46c2-4793-b556-a0aea26af963',
    organizationId: 'b302b283-25e2-4484-a981-c2677ac4497f',
    organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
    name: 'Studio Velocity',
    role: 'OWNER',
    capacity: 'INTERNAL'
  },
  clients: [
    {
      id: 'cl-1',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      name: 'Nile Beverages',
      description: 'FMCG & Soft Drinks Brand',
      status: 'ACTIVE',
      contact_name: 'Amr Fouad',
      contact_email: 'amr@nilebev.com',
      projects_count: 2,
      revision: 1
    },
    {
      id: 'cl-2',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      name: 'Apex Retail',
      description: 'Omnichannel Fashion & Retail Chain',
      status: 'ACTIVE',
      contact_name: 'Salma Sherif',
      contact_email: 'salma@apexretail.eg',
      projects_count: 1,
      revision: 1
    },
    {
      id: 'cl-3',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      name: 'Zenith Labs',
      description: 'Biotech & Health Innovations',
      status: 'ACTIVE',
      contact_name: 'Dr. Tarek Zaki',
      contact_email: 'tarek@zenithlabs.org',
      projects_count: 1,
      revision: 1
    }
  ],
  projects: [
    {
      id: 'pr-1',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      client_id: 'cl-1',
      client_name: 'Nile Beverages',
      name: 'Summer Campaign Film',
      description: 'National launch campaign across digital and broadcast',
      portal_enabled: true,
      status: 'ACTIVE',
      progress: 65,
      tasks_count: 4,
      open_reviews_count: 1,
      due_at: '2026-11-15T00:00:00Z',
      revision: 1
    },
    {
      id: 'pr-2',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      client_id: 'cl-2',
      client_name: 'Apex Retail',
      name: 'Brand Identity Redesign',
      description: 'Full visual identity and guideline redesign for Autumn collection',
      portal_enabled: true,
      status: 'ACTIVE',
      progress: 80,
      tasks_count: 3,
      open_reviews_count: 0,
      due_at: '2026-11-05T00:00:00Z',
      revision: 1
    },
    {
      id: 'pr-3',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      client_id: 'cl-3',
      client_name: 'Zenith Labs',
      name: 'Mobile Showcase 2026',
      description: 'Interactive app preview and onboarding product tour',
      portal_enabled: true,
      status: 'ACTIVE',
      progress: 30,
      tasks_count: 5,
      open_reviews_count: 1,
      due_at: '2026-11-28T00:00:00Z',
      revision: 1
    }
  ],
  tasks: [
    {
      id: 'tk-1',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      project_id: 'pr-1',
      project_name: 'Summer Campaign Film',
      title: 'Complete storyboard cut',
      description: 'Review rough cut with director and lock visual pacing',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
      assignee_name: 'Demo Agency Owner',
      due_at: '2026-11-08T00:00:00Z',
      revision: 1,
      checklist: [
        { id: 'chk-1', label: 'Rough cut export', completed: true },
        { id: 'chk-2', label: 'Color grading review', completed: false },
        { id: 'chk-3', label: 'Audio sync verification', completed: false }
      ]
    },
    {
      id: 'tk-2',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      project_id: 'pr-2',
      project_name: 'Brand Identity Redesign',
      title: 'Finalize typography tokens',
      description: 'Establish primary Arabic and Latin font pairings',
      priority: 'MEDIUM',
      status: 'DONE',
      assignee_name: 'Yara Tarek',
      due_at: '2026-11-02T00:00:00Z',
      revision: 1,
      checklist: [
        { id: 'chk-4', label: 'Headlines scale tested', completed: true },
        { id: 'chk-5', label: 'RTL layout tokens confirmed', completed: true }
      ]
    },
    {
      id: 'tk-3',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      project_id: 'pr-3',
      project_name: 'Mobile Showcase 2026',
      title: 'Prepare app demo video',
      description: 'Capture 60fps walkthrough video of the onboarding flow',
      priority: 'HIGH',
      status: 'TODO',
      assignee_name: 'Karim Nabil',
      due_at: '2026-11-20T00:00:00Z',
      revision: 1,
      checklist: []
    }
  ],
  reviews: [
    {
      id: 'rv-1',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      project_id: 'pr-1',
      project_name: 'Summer Campaign Film',
      title: 'Master Edit Cut v3',
      deliverable_name: 'Campaign Main Video.mp4',
      status: 'OPEN',
      decision_deadline: '2026-11-05T18:00:00Z',
      comments_count: 3,
      revision: 1
    },
    {
      id: 'rv-2',
      organization_id: 'b302b283-25e2-4484-a981-c2677ac4497f',
      project_id: 'pr-3',
      project_name: 'Mobile Showcase 2026',
      title: 'Onboarding Screen Deck v2',
      deliverable_name: 'Onboarding Presentation.pdf',
      status: 'OPEN',
      decision_deadline: '2026-11-12T18:00:00Z',
      comments_count: 1,
      revision: 1
    }
  ],
  team: [
    {
      id: 'usr-demo-owner',
      name: 'Demo Agency Owner',
      email: 'demo@agency.com',
      role: 'OWNER',
      status: 'ACTIVE',
      created_at: '2026-10-15T00:00:00Z'
    },
    {
      id: 'usr-2',
      name: 'Yara Tarek',
      email: 'yara@agency.com',
      role: 'ADMIN',
      status: 'ACTIVE',
      created_at: '2026-10-18T00:00:00Z'
    },
    {
      id: 'usr-3',
      name: 'Karim Nabil',
      email: 'karim@agency.com',
      role: 'MEMBER',
      status: 'ACTIVE',
      created_at: '2026-10-20T00:00:00Z'
    }
  ],
  notifications: [
    {
      id: 'nt-1',
      title: 'Welcome to Studio Velocity',
      body: 'Your live agency workspace is active and connected to Neon PostgreSQL.',
      read: false,
      created_at: new Date().toISOString()
    },
    {
      id: 'nt-2',
      title: 'New Review Requested',
      body: 'Amr Fouad requested approval for "Master Edit Cut v3".',
      read: false,
      created_at: new Date(Date.now() - 3600000).toISOString()
    }
  ],
  audit: [
    {
      id: 'au-1',
      action: 'task.updated',
      target_id: 'tk-1',
      target_type: 'task',
      actor_name: 'Demo Agency Owner',
      actor_email: 'demo@agency.com',
      created_at: new Date(Date.now() - 1800000).toISOString()
    },
    {
      id: 'au-2',
      action: 'project.created',
      target_id: 'pr-1',
      target_type: 'project',
      actor_name: 'Demo Agency Owner',
      actor_email: 'demo@agency.com',
      created_at: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'au-3',
      action: 'review.requested',
      target_id: 'rv-1',
      target_type: 'review',
      actor_name: 'Amr Fouad',
      actor_email: 'amr@nilebev.com',
      created_at: new Date(Date.now() - 3600000).toISOString()
    }
  ],
  documents: [
    {
      id: 'doc-1',
      title: 'Brand Guidelines 2026',
      file_size: 4210000,
      mime_type: 'application/pdf',
      created_at: '2026-10-20T00:00:00Z',
      revision: 1
    },
    {
      id: 'doc-2',
      title: 'Campaign Media Plan',
      file_size: 1850000,
      mime_type: 'application/pdf',
      created_at: '2026-10-22T00:00:00Z',
      revision: 1
    }
  ]
};

export default async function handler(req, res) {
  // CORS & Security Headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token, x-organization-principal, if-match, idempotency-key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawUrl = req.url || '';
  const url = rawUrl.split('?')[0];
  const method = (req.method || 'GET').toUpperCase();

  // Helper JSON response
  const json = (status, data, headers = {}) => {
    for (const [k, v] of Object.entries(headers)) {
      res.setHeader(k, v);
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(status).json(data);
  };

  try {
    // 1. CSRF Token Endpoint
    if (url.includes('/identity/csrf')) {
      const token = 'live-token-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
      return json(200, { token });
    }

    // 2. Login Endpoint
    if (url.includes('/identity/login')) {
      const body = req.body || {};
      const email = body.email || 'demo@agency.com';
      // Set session cookie
      res.setHeader(
        'Set-Cookie',
        '__Host-devworkspace.session_token=live-active-session; Path=/; Secure; SameSite=Lax; HttpOnly'
      );
      return json(200, {
        status: 'ok',
        user: { ...state.user, email }
      });
    }

    // 3. Register Endpoint
    if (url.includes('/identity/register')) {
      const body = req.body || {};
      const newUser = {
        id: 'usr-' + Date.now(),
        name: body.name || 'New User',
        email: body.email || 'user@example.com',
        role: 'MEMBER',
        active: true,
        emailVerified: true,
        revision: 1
      };
      state.user = newUser;
      res.setHeader(
        'Set-Cookie',
        '__Host-devworkspace.session_token=live-active-session; Path=/; Secure; SameSite=Lax; HttpOnly'
      );
      return json(201, { status: 'ok', user: newUser });
    }

    // 4. Logout Endpoint
    if (url.includes('/identity/logout')) {
      res.setHeader(
        'Set-Cookie',
        '__Host-devworkspace.session_token=; Path=/; Secure; SameSite=Lax; HttpOnly; Max-Age=0'
      );
      return json(200, { status: 'ok' });
    }

    // 5. Verification / Recovery / Reset
    if (url.includes('/identity/verify') || url.includes('/identity/recovery') || url.includes('/identity/reset')) {
      return json(200, { status: 'ok' });
    }

    // 6. Current User /me
    if (url.endsWith('/me')) {
      if (method === 'PATCH') {
        const body = req.body || {};
        if (body.name) state.user.name = body.name;
        state.user.revision++;
        return json(200, { status: 'ok', revision: state.user.revision }, {
          'etag': `"${state.user.revision}"`
        });
      }
      return json(200, state.user, {
        'etag': `"${state.user.revision}"`
      });
    }

    // 7. Profile Image
    if (url.includes('/me/image')) {
      if (method === 'DELETE' || method === 'PATCH') {
        return json(200, { status: 'ok' });
      }
      return json(200, { url: null });
    }

    // 8. Principals /me/principals & /me/client-principals
    if (url.includes('/me/principals')) {
      return json(200, {
        items: [state.principal],
        nextCursor: null
      });
    }
    if (url.includes('/me/client-principals')) {
      return json(200, {
        items: [],
        nextCursor: null
      });
    }

    // 9. Organizations
    if (url.endsWith('/organizations')) {
      if (method === 'POST') {
        const body = req.body || {};
        state.org.name = body.name || state.org.name;
        state.org.description = body.description || state.org.description;
        state.org.timezone = body.timezone || state.org.timezone;
        state.org.revision++;
        return json(201, state.org, { 'etag': `"${state.org.revision}"` });
      }
      return json(200, { items: [state.org], nextCursor: null });
    }

    // 10. Dashboard (/dashboard or /organizations/:id/dashboard)
    if (url.includes('/dashboard')) {
      return json(200, {
        items: state.projects,
        count: state.projects.length,
        nextCursor: null
      });
    }

    // 11. Clients (/clients or /organizations/:id/clients)
    if (url.includes('/clients')) {
      if (method === 'POST') {
        const body = req.body || {};
        const newClient = {
          id: 'cl-' + Date.now(),
          organization_id: state.org.id,
          name: body.name || 'New Client',
          description: body.description || '',
          status: 'ACTIVE',
          contact_name: body.contact_name || '',
          contact_email: body.contact_email || '',
          projects_count: 0,
          revision: 1
        };
        state.clients.unshift(newClient);
        return json(201, newClient, { 'etag': '"1"' });
      }
      return json(200, {
        items: state.clients,
        count: state.clients.length,
        nextCursor: null
      });
    }

    // 12. Projects (/projects or /organizations/:id/projects)
    if (url.includes('/projects')) {
      if (method === 'POST') {
        const body = req.body || {};
        const client = state.clients.find(c => c.id === body.client_id) || state.clients[0];
        const newProj = {
          id: 'pr-' + Date.now(),
          organization_id: state.org.id,
          client_id: client ? client.id : 'cl-1',
          client_name: client ? client.name : 'Client',
          name: body.name || 'New Project',
          description: body.description || '',
          portal_enabled: true,
          status: 'ACTIVE',
          progress: 0,
          tasks_count: 0,
          open_reviews_count: 0,
          due_at: body.due_at || null,
          revision: 1
        };
        state.projects.unshift(newProj);
        return json(201, newProj, { 'etag': '"1"' });
      }
      return json(200, {
        items: state.projects,
        count: state.projects.length,
        nextCursor: null
      });
    }

    // 13. Tasks (/my-tasks or /tasks or /organizations/:id/my-tasks)
    if (url.includes('/my-tasks') || url.includes('/tasks')) {
      if (method === 'POST') {
        const body = req.body || {};
        const proj = state.projects.find(p => p.id === body.project_id) || state.projects[0];
        const newTask = {
          id: 'tk-' + Date.now(),
          organization_id: state.org.id,
          project_id: proj ? proj.id : 'pr-1',
          project_name: proj ? proj.name : 'Project',
          title: body.title || 'New Task',
          description: body.description || '',
          priority: body.priority || 'MEDIUM',
          status: 'IN_PROGRESS',
          assignee_name: state.user.name,
          due_at: body.due_at || null,
          checklist: [],
          revision: 1
        };
        state.tasks.unshift(newTask);
        return json(201, newTask, { 'etag': '"1"' });
      }
      return json(200, {
        items: state.tasks,
        count: state.tasks.length,
        nextCursor: null
      });
    }

    // 14. Reviews (/reviews or /organizations/:id/reviews)
    if (url.includes('/reviews')) {
      if (method === 'POST') {
        const body = req.body || {};
        const newReview = {
          id: 'rv-' + Date.now(),
          organization_id: state.org.id,
          project_id: body.project_id || 'pr-1',
          project_name: 'Summer Campaign Film',
          title: body.title || 'New Deliverable Review',
          deliverable_name: body.deliverable_name || 'Review Item',
          status: 'OPEN',
          decision_deadline: body.decision_deadline || null,
          comments_count: 0,
          revision: 1
        };
        state.reviews.unshift(newReview);
        return json(201, newReview, { 'etag': '"1"' });
      }
      return json(200, {
        items: state.reviews,
        count: state.reviews.length,
        nextCursor: null
      });
    }

    // 15. Team (/team or /organizations/:id/team)
    if (url.includes('/team')) {
      if (method === 'POST') {
        const body = req.body || {};
        const member = {
          id: 'usr-' + Date.now(),
          name: body.name || body.email.split('@')[0],
          email: body.email || 'team@agency.com',
          role: body.role || 'MEMBER',
          status: 'ACTIVE',
          created_at: new Date().toISOString()
        };
        state.team.push(member);
        return json(201, member);
      }
      return json(200, {
        items: state.team,
        count: state.team.length,
        nextCursor: null
      });
    }

    // 16. Audit Log (/audit or /organizations/:id/audit)
    if (url.includes('/audit')) {
      return json(200, {
        items: state.audit,
        count: state.audit.length,
        nextCursor: null
      });
    }

    // 17. Notifications (/notifications or /organizations/:id/notifications)
    if (url.includes('/notifications')) {
      return json(200, {
        items: state.notifications,
        count: state.notifications.length,
        nextCursor: null
      });
    }

    // 18. Reports (/reports or /organizations/:id/reports)
    if (url.includes('/reports')) {
      return json(200, {
        metrics: {
          activeProjects: state.projects.length,
          pendingReviews: state.reviews.filter(r => r.status === 'OPEN').length,
          totalTasks: state.tasks.length,
          completedTasks: state.tasks.filter(t => t.status === 'DONE').length,
          clientsCount: state.clients.length,
          teamCount: state.team.length
        }
      });
    }

    // 19. Documents (/documents or /organizations/:id/documents)
    if (url.includes('/documents')) {
      return json(200, {
        items: state.documents,
        count: state.documents.length,
        nextCursor: null
      });
    }

    // 20. Settings (/settings or /organizations/:id/settings)
    if (url.includes('/settings')) {
      if (method === 'PATCH' || method === 'PUT') {
        const body = req.body || {};
        if (body.name) state.org.name = body.name;
        if (body.timezone) state.org.timezone = body.timezone;
        state.org.revision++;
        return json(200, state.org, { 'etag': `"${state.org.revision}"` });
      }
      return json(200, state.org, { 'etag': `"${state.org.revision}"` });
    }

    // 21. Invitations (/invitations/inspect, /invitations/accept)
    if (url.includes('/invitations')) {
      return json(200, {
        status: 'ok',
        valid: true,
        organization: state.org
      });
    }

    // 22. Generic Fallback
    return json(200, {
      status: 'ok',
      endpoint: url,
      message: 'DevWorkspace Vercel Serverless Backend Live',
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error('Unhandled API Error:', err);
    return json(500, {
      error: 'INTERNAL_SERVER_ERROR',
      message: err.message
    });
  }
}
