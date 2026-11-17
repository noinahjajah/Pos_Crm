// แอปทั้งหมด: providers + router

import { RouterProvider } from 'react-router-dom'
import { Providers } from './app/providers.jsx'
import { router } from './app/router.jsx'

export default function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
