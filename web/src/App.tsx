import { Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import Overview from './pages/Overview'
import Products from './pages/Products'
import ProductDetail from './pages/ProductDetail'
import Suppliers from './pages/Suppliers'
import SupplierDetail from './pages/SupplierDetail'
import Lots from './pages/Lots'
import LotDetail from './pages/LotDetail'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Machines from './pages/Machines'
import MachineDetail from './pages/MachineDetail'
import Inspections from './pages/Inspections'
import InspectionDetail from './pages/InspectionDetail'
import Defects from './pages/Defects'
import DefectDetail from './pages/DefectDetail'
import Explorer from './pages/Explorer'
import Capa from './pages/Capa'
import CapaDetail from './pages/CapaDetail'
import Analytics from './pages/Analytics'
import Quality from './pages/Quality'
import SettingsPage from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/suppliers/:id" element={<SupplierDetail />} />
        <Route path="/lots" element={<Lots />} />
        <Route path="/lots/:id" element={<LotDetail />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/orders/:id" element={<OrderDetail />} />
        <Route path="/machines" element={<Machines />} />
        <Route path="/machines/:id" element={<MachineDetail />} />
        <Route path="/inspections" element={<Inspections />} />
        <Route path="/inspections/:id" element={<InspectionDetail />} />
        <Route path="/defects" element={<Defects />} />
        <Route path="/defects/:id" element={<DefectDetail />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="/capa" element={<Capa />} />
        <Route path="/capa/:id" element={<CapaDetail />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/quality" element={<Quality />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  )
}
