import { CatalogPage } from "@/pages/Catalog/CatalogPage"
import { ProductDetailsPage } from "@/pages/ProductDetails/ProductDetailsPage"
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom"

function ProductRoute() {
  const { productId } = useParams()
  return <ProductDetailsPage productId={productId} />
}

export default function App() {
  return <BrowserRouter><Routes><Route path="/catalog" element={<CatalogPage />} /><Route path="/catalog/:productId" element={<ProductRoute />} /><Route path="*" element={<Navigate to="/catalog" replace />} /></Routes></BrowserRouter>
}
