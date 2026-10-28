import path from 'node:path';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { requestId } from './middleware/requestId.js';
import { loadSession, requireAuth, requireJson } from './middleware/session.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { teachersRouter } from './modules/teachers/teachers.routes.js';
import { assignmentsRouter } from './modules/assignments/assignments.routes.js';
import { schoolsRouter } from './modules/schools/schools.routes.js';
import { timetableRouter } from './modules/timetable/timetable.routes.js';
import { lessonsRouter } from './modules/lessons/lessons.routes.js';
import { curriculumRouter } from './modules/curriculum/curriculum.routes.js';
import { recordsRouter } from './modules/teaching-records/records.routes.js';
import { progressRouter } from './modules/progress/progress.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/healthz' },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
      },
    }),
  );
  app.use(helmet());

  // Development only: the Vite dev server runs on another port. Production serves both from one origin.
  if (env.corsOrigins.length) {
    app.use((req, res, next) => {
      const origin = req.get('origin');
      if (origin && env.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Request-Id');
          res.status(204).end();
          return;
        }
      }
      next();
    });
  }

  app.use(healthRouter);

  const api = Router();
  api.use(express.json({ limit: '5mb' }));
  api.use(rateLimit({ name: 'api', windowMs: 60 * 1000, max: 600 }));
  api.use(loadSession);
  api.use(requireJson);
  api.use(authRouter);

  // Everything below requires a signed-in user; school scope comes from the session.
  api.use(requireAuth);
  api.use(teachersRouter);
  api.use(assignmentsRouter);
  api.use(schoolsRouter);
  api.use(timetableRouter);
  api.use(lessonsRouter);
  api.use(curriculumRouter);
  api.use(recordsRouter);
  api.use(progressRouter);
  api.use(notificationsRouter);
  api.use(reportsRouter);

  app.use('/api/v1', api);

  // Production: serve the built web app from the same origin. Helmet's Content Security Policy
  // (scripts only from this origin, no inline scripts) then covers the pages too, which matters
  // because each tab keeps its session token in sessionStorage.
  if (env.WEB_DIST_DIR) {
    const dir = path.resolve(env.WEB_DIST_DIR);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
