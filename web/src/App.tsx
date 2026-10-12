import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import { Layout, RequireAdmin, RequireAuth, ToastProvider } from './components';
import { AcceptableUse, Contact, FAQ, Home, HowItWorks, Privacy, RefundPolicy, StatusPage, Terms } from './pages/public';
import { Pricing, ServiceDetailPage, Services } from './pages/catalog';
import { AdminSetup, Login, Register } from './pages/authpages';
import {
  DashboardLayout, DashOverview, NewOrder, NewTicket, OrderDetail, OrdersList,
  Security, TicketDetail, Tickets, Transactions,
} from './pages/dashboard';
import {
  AdminAbuse, AdminAudit, AdminLayout, AdminLedger, AdminOrders, AdminOverview,
  AdminPayments, AdminPricing, AdminProviders, AdminSettings, AdminTickets, AdminUsers,
} from './pages/admin';

function NotFound() {
  return (
    <div className="empty-state">
      <div className="icon">🧭</div>
      <h1>Page not found</h1>
      <p>That page doesn't exist. Try the <a href="/">homepage</a> or the <a href="/services">catalogue</a>.</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/services/:code" element={<ServiceDetailPage />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/setup" element={<AdminSetup />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/refund-policy" element={<RefundPolicy />} />
            <Route path="/acceptable-use" element={<AcceptableUse />} />

            <Route path="/dashboard" element={<RequireAuth><DashboardLayout /></RequireAuth>}>
              <Route index element={<DashOverview />} />
              <Route path="orders" element={<OrdersList />} />
              <Route path="orders/new" element={<NewOrder />} />
              <Route path="orders/:id" element={<OrderDetail />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="tickets" element={<Tickets />} />
              <Route path="tickets/new" element={<NewTicket />} />
              <Route path="tickets/:id" element={<TicketDetail />} />
              <Route path="security" element={<Security />} />
            </Route>

            <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="providers" element={<AdminProviders />} />
              <Route path="pricing" element={<AdminPricing />} />
              <Route path="ledger" element={<AdminLedger />} />
              <Route path="tickets" element={<AdminTickets />} />
              <Route path="abuse" element={<AdminAbuse />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      </ToastProvider>
    </AuthProvider>
  );
}
