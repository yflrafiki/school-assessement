import { Outlet, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { HomeRedirect, RequireAuth, RequirePermission, SessionWatcher } from './guards';
import {
  ActivatePage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
} from '../features/auth/AuthPages';
import { ProfilePage } from '../features/auth/ProfilePage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { TeacherOverview } from '../features/teacher/TeacherOverview';
import { MySubjects } from '../features/teacher/MySubjects';
import { SchemeOfWork } from '../features/teacher/SchemeOfWork';
import { RecordLessonPage } from '../features/teacher/RecordLessonPage';
import { WeeklyProgress } from '../features/teacher/WeeklyProgress';
import { RecordsPage } from '../features/records/RecordsPage';
import { TeacherRecordPage } from '../features/records/RecordDetail';
import { HeadOverview } from '../features/headmaster/HeadOverview';
import { DailyLessons } from '../features/headmaster/DailyLessons';
import { TeachersPage } from '../features/headmaster/TeachersPage';
import { TeacherDetailPage } from '../features/headmaster/TeacherDetailPage';
import { AssignmentsPage } from '../features/headmaster/AssignmentsPage';
import { TimetablePage } from '../features/headmaster/TimetablePage';
import { ProgressPage } from '../features/headmaster/ProgressPage';
import { CurriculumPage } from '../features/headmaster/CurriculumPage';
import { ImportReviewPage } from '../features/headmaster/ImportReviewPage';
import { ReportsPage } from '../features/headmaster/ReportsPage';
import { SettingsPage } from '../features/headmaster/SettingsPage';
import { EmptyState } from '../components/States';
import { useMe } from '../features/auth/useMe';
import { Navigate } from 'react-router-dom';

function Root() {
  return (
    <>
      <SessionWatcher />
      <Outlet />
    </>
  );
}

/** School admins have no overview; send them to their first page. */
function HeadIndex() {
  const me = useMe();
  if (me.data && !me.data.permissions.includes('reports.view'))
    return <Navigate to="/h/teachers" replace />;
  return <HeadOverview />;
}

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The address may be mistyped, or the page has moved."
      action={
        <a href="/" className="btn-secondary">
          Go home
        </a>
      }
    />
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/activate', element: <ActivatePage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      {
        path: '/t',
        element: (
          <RequireAuth roles={['TEACHER']}>
            <AppShell area="teacher" />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <TeacherOverview /> },
          { path: 'subjects', element: <MySubjects /> },
          { path: 'scheme', element: <SchemeOfWork /> },
          { path: 'lessons/:lessonId/record', element: <RecordLessonPage /> },
          { path: 'records', element: <RecordsPage area="teacher" /> },
          { path: 'records/:id', element: <TeacherRecordPage /> },
          { path: 'progress', element: <WeeklyProgress /> },
          { path: 'notifications', element: <NotificationsPage area="teacher" /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        path: '/h',
        element: (
          <RequireAuth roles={['HEADMASTER', 'SCHOOL_ADMIN']}>
            <AppShell area="headmaster" />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HeadIndex /> },
          {
            path: 'daily',
            element: (
              <RequirePermission permission="lessons.manage">
                <DailyLessons />
              </RequirePermission>
            ),
          },
          {
            path: 'activity',
            element: (
              <RequirePermission permission="records.view_all">
                <RecordsPage area="headmaster" />
              </RequirePermission>
            ),
          },
          {
            path: 'teachers',
            element: (
              <RequirePermission permission="teachers.manage">
                <TeachersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'teachers/:id',
            element: (
              <RequirePermission permission="teachers.manage">
                <TeacherDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: 'assignments',
            element: (
              <RequirePermission permission="school.setup">
                <AssignmentsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'timetable',
            element: (
              <RequirePermission permission="timetable.manage">
                <TimetablePage />
              </RequirePermission>
            ),
          },
          {
            path: 'progress',
            element: (
              <RequirePermission permission="reports.view">
                <ProgressPage />
              </RequirePermission>
            ),
          },
          {
            path: 'curriculum',
            element: (
              <RequirePermission permission="curriculum.import">
                <CurriculumPage />
              </RequirePermission>
            ),
          },
          {
            path: 'curriculum/imports/:id',
            element: (
              <RequirePermission permission="curriculum.import">
                <ImportReviewPage />
              </RequirePermission>
            ),
          },
          {
            path: 'reports',
            element: (
              <RequirePermission permission="reports.view">
                <ReportsPage />
              </RequirePermission>
            ),
          },
          { path: 'notifications', element: <NotificationsPage area="headmaster" /> },
          {
            path: 'settings',
            element: (
              <RequirePermission permission="school.setup">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        path: '*',
        element: (
          <div className="p-8">
            <NotFound />
          </div>
        ),
      },
    ],
  },
]);
