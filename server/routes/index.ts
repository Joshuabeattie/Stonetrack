// Every /api route, in one list, so you can see the whole API surface at a glance.
// (POST /api/webhooks/orders is registered in app.ts because it needs the raw body.)
import { Router } from 'express'
import { authenticate } from '../auth/middleware'
import { adminRoutes } from './admin'
import { authRoutes } from './auth'
import { jobRoutes } from './jobs'
import { metaRoutes } from './meta'
import { planningRoutes } from './planning'
import { publicRoutes } from './public'
import { referenceRoutes } from './reference'
import { slabRoutes } from './slabs'
import { webhookAdminRoutes } from './webhooks'

export function apiRouter(): Router {
  const router = Router()
  router.use(authenticate) // sets req.user when a valid token is sent; never blocks on its own

  router.use(metaRoutes) //                GET  /meta, /health                          public
  router.use('/auth', authRoutes) //       POST /auth/login, /auth/logout; GET /auth/me
  router.use('/public', publicRoutes) //   GET  /public/jobs/:token                     client portal, no sign-in
  router.use('/jobs', jobRoutes) //        jobs, stage changes, remakes, allocation, share links
  router.use('/slabs', slabRoutes) //      stock levels, receiving, releasing
  router.use(referenceRoutes) //           /materials, /operators, /clients, /machines, /kiosk/jobs
  router.use(planningRoutes) //            /capacity, /kpis
  router.use('/webhooks', webhookAdminRoutes) // /webhooks/events, /example, /test          admin
  router.use(adminRoutes) //               /users, /admin/reset-demo                    admin
  return router
}
