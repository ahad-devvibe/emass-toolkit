import { AuthProvider } from "@/auth/AuthProvider"
import { GuestOnly, RequireAuth } from "@/auth/RequireAuth"
import { AuthLayout } from "@/components/common/AuthLayout"
import { RequireRole, RoleHome } from "@/auth/RequireRole"
import type { UserRole } from "@/auth/auth.types"
import { CatalogPage } from "@/pages/Catalog/CatalogPage"
import { ProductDetailsPage } from "@/pages/ProductDetails/ProductDetailsPage"
import { ReleaseDetailPage } from "@/pages/ReleaseDetail/ReleaseDetailPage"
import { ReleaseEditorPage } from "@/pages/ReleaseEditor/ReleaseEditorPage"
import { ReleasesPage } from "@/pages/Releases/ReleasesPage"
import { SignInPage } from "@/pages/SignIn/SignInPage"
import { SignUpPage } from "@/pages/SignUp/SignUpPage"
import { SignupsPage } from "@/pages/Signups/SignupsPage"
import type { ReactNode } from "react"
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom"

const STAFF: UserRole[] = ["DEV", "ADMIN"]

function ProductRoute() {
  const { productId } = useParams()
  return <ProductDetailsPage productId={productId} />
}

// key remounts the page when the id changes so its local state starts fresh
function ReleaseRoute() {
  const { releaseId } = useParams()
  return <ReleaseDetailPage key={releaseId} releaseId={releaseId} />
}

function ReleaseEditRoute() {
  const { releaseId } = useParams()
  return <ReleaseEditorPage key={releaseId} releaseId={releaseId} />
}

const staff = (page: ReactNode) => <RequireAuth><RequireRole roles={STAFF}>{page}</RequireRole></RequireAuth>
// The catalog is customer-only; staff are sent to their own home (/releases)
const customer = (page: ReactNode) => <RequireAuth><RequireRole roles={["CUSTOMER"]}>{page}</RequireRole></RequireAuth>

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* One persistent shell so the brand panel doesn't remount between auth pages */}
          <Route element={<AuthLayout />}>
            <Route path="/sign-in" element={<GuestOnly><SignInPage /></GuestOnly>} />
            <Route path="/sign-up" element={<GuestOnly><SignUpPage /></GuestOnly>} />
          </Route>
          <Route path="/catalog" element={customer(<CatalogPage />)} />
          <Route path="/catalog/:productId" element={customer(<ProductRoute />)} />
          <Route path="/releases" element={staff(<ReleasesPage />)} />
          {/* Only DEVs create releases; admins review them */}
          <Route path="/releases/new" element={<RequireAuth><RequireRole roles={["DEV"]}><ReleaseEditorPage key="new" /></RequireRole></RequireAuth>} />
          <Route path="/releases/:releaseId" element={staff(<ReleaseRoute />)} />
          <Route path="/releases/:releaseId/edit" element={staff(<ReleaseEditRoute />)} />
          <Route path="/admin/signups" element={<RequireAuth><RequireRole roles={["ADMIN"]}><SignupsPage /></RequireRole></RequireAuth>} />
          <Route path="*" element={<RequireAuth><RoleHome /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
