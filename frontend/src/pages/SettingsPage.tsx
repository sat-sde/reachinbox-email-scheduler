import SlackIntegrationCard from '../components/SlackIntegrationCard'

export default function SettingsPage() {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings & Integrations</h2>
        <p className="text-sm text-gray-500 mt-1">
          Manage your external workspace connections and automated notification alerts.
        </p>
      </div>

      <SlackIntegrationCard />
    </div>
  )
}


