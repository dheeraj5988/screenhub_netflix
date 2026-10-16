"use client"

import type React from "react"
import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Users,
  Cookie,
  Activity,
  Settings,
  Search,
  Plus,
  Upload,
  Download,
  Trash2,
  Edit,
  Check,
  X,
  Lock,
  LogOut,
  Calendar,
  Smartphone,
  Play,
  FileSpreadsheet,
  Shield,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Tv,
  Database,
  XCircle,
} from "lucide-react"
import { calculateExpiryDate, formatDisplayDate, parseBulkSubscribers } from "@/lib/validity"

interface Customer {
  id: string
  mobile: string
  service: string
  subscriptionDate: string
  validity: string
  expiryDate: string
  assignedAccountId: string | null
  isBlocked: boolean
  totalUpdates: number
  lastUpdateAt: string | null
  tvLoginsThisMonth: number
  history: Array<{
    id: string
    date: string
    action: "tv_login" | "household_update"
    status: string
    code?: string
    notes?: string
  }>
}

interface NetflixAccount {
  id: string
  profileName: string
  accountLabel: string
  accountEmail?: string
  userAgent?: string
  cookies: any[]
  status: "live" | "expiring_soon" | "expired" | "needs_reimport" | "unverified" | "unknown"
  earliestExpiryIso?: string | null
  lastCheckedAt: string | null
  lastRefreshedAt?: string | null
  lastResult: string | null
  lastDetail: string
}

interface AppSettings {
  companyName: string
  supportWhatsapp: string
  maxUpdatesPerMonth: number
  logRetentionDays: number
}

interface Metrics {
  totalSubscribers: number
  activeSubscribers: number
  expiredSubscribers: number
  blockedSubscribers: number
  activationsToday: number
  activationsMonth: number
  totalCookieAccounts: number
  activeCookies: number
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState("")
  const [loginError, setLoginError] = useState("")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"dashboard" | "customers" | "cookies" | "logs" | "settings">("dashboard")

  // Data states
  const [customers, setCustomers] = useState<Customer[]>([])
  const [netflixCookies, setNetflixCookies] = useState<NetflixAccount[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [activationsLog, setActivationsLog] = useState<any[]>([])
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("")
  const [customerFilter, setCustomerFilter] = useState<"all" | "active" | "expired" | "cooldown" | "blocked">("all")

  // Modals
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [showBulkImportModal, setShowBulkImportModal] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkPreview, setBulkPreview] = useState<any[]>([])
  const [bulkMessage, setBulkMessage] = useState("")

  // Customer Form state
  const [custMobile, setCustMobile] = useState("")
  const [custService, setCustService] = useState("Netflix 4K")
  const [custSubDate, setCustSubDate] = useState(new Date().toISOString().slice(0, 10))
  const [custValidity, setCustValidity] = useState("1 Month")
  const [custExpDate, setCustExpDate] = useState("")
  const [custAssignedAcc, setCustAssignedAcc] = useState<string>("")
  const [custBlocked, setCustBlocked] = useState(false)
  const [formError, setFormError] = useState("")

  // Customer History Modal
  const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<Customer | null>(null)

  // Cookie Form state
  const [showAddCookieModal, setShowAddCookieModal] = useState(false)
  const [editingCookie, setEditingCookie] = useState<NetflixAccount | null>(null)
  const [cookieProfileName, setCookieProfileName] = useState("")
  const [cookieEmail, setCookieEmail] = useState("")
  const [cookieRawJson, setCookieRawJson] = useState("")
  const [cookieUserAgent, setCookieUserAgent] = useState("")
  const [cookieError, setCookieError] = useState("")
  const [testingCookieId, setTestingCookieId] = useState<string | null>(null)
  const [testingAllCookies, setTestingAllCookies] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{
    provider?: string
    label?: string
    isPersistent?: boolean
    details?: string
  } | null>(null)

  const [storageError, setStorageError] = useState("")
  const [build, setBuild] = useState<{ version: string; commit: string } | null>(null)

  // Settings state
  const [maxUpdates, setMaxUpdates] = useState("2")
  const [settingsSuccess, setSettingsSuccess] = useState("")

  // On mount check token
  useEffect(() => {
    try {
      localStorage.removeItem("screenhub_admin_backup")
    } catch {
      // ignore
    }
    const savedToken = localStorage.getItem("screenhub_admin_token")
    if (savedToken) {
      setToken(savedToken)
      fetchAdminData(savedToken)
    } else {
      setLoading(false)
    }
  }, [])

  // Auto-calculate expiry date when subscription date or validity changes in the form
  useEffect(() => {
    if (custSubDate && custValidity) {
      const calculated = calculateExpiryDate(custSubDate, custValidity)
      setCustExpDate(calculated)
    }
  }, [custSubDate, custValidity])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError("")
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setToken(data.token)
        localStorage.setItem("screenhub_admin_token", data.token)
        fetchAdminData(data.token)
      } else {
        setLoginError(data.message || "Invalid password")
      }
    } catch {
      setLoginError("Failed to connect to server")
    }
  }

  const handleLogout = () => {
    localStorage.removeItem("screenhub_admin_token")
    setToken(null)
    setPasswordInput("")
  }

  const getAuthHeaders = () => {
    const activeToken = token || (typeof window !== "undefined" ? localStorage.getItem("screenhub_admin_token") : null) || ""
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeToken}`,
    }
  }

  const fetchAdminData = async (adminToken: string) => {
    setLoading(true)
    try {
      const activeToken = adminToken || (typeof window !== "undefined" ? localStorage.getItem("screenhub_admin_token") : null) || ""
      const res = await fetch("/api/admin/data", {
        headers: { Authorization: `Bearer ${activeToken}` },
        cache: "no-store",
      })
      const data = await res.json()
      if (data.build) setBuild(data.build)
      if (res.ok && data.ok) {
        setStorageError("")
        setCustomers(data.data.customers || [])
        setNetflixCookies(data.data.netflixCookies || [])
        setSettings(data.data.settings || null)
        setActivationsLog(data.data.activationsLog || [])
        setMetrics(data.data.metrics || null)
        if (data.storage) {
          setStorageInfo(data.storage)
        }

        if (data.data.settings) {
          setMaxUpdates(String(data.data.settings.maxUpdatesPerMonth || 2))
        }
      } else if (res.status === 401) {
        handleLogout()
      } else {
        // Never show stale or empty data as if it were real: surface the storage error.
        setStorageError(data.message || `Server error (HTTP ${res.status})`)
        if (data.storage) setStorageInfo(data.storage)
      }
    } catch (err) {
      console.error("Error fetching admin data:", err)
      setStorageError("Could not reach the server")
    } finally {
      setLoading(false)
    }
  }

  // TV logins used this calendar month (counted on the server, India time)
  const getCustomerCooldownInfo = (c: Customer) => {
    const max = settings?.maxUpdatesPerMonth ?? 2
    const monthUsed = c.tvLoginsThisMonth || 0
    return { isMonthlyMax: monthUsed >= max, monthUsed, max }
  }

  // Filter customers
  const filteredCustomers = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return customers.filter((c) => {
      // Search match
      const q = searchQuery.trim().toLowerCase()
      if (q && !c.mobile.includes(q) && !c.service.toLowerCase().includes(q)) {
        return false
      }

      // Filter match
      const isExpired = c.expiryDate && c.expiryDate < today
      const cooldownInfo = getCustomerCooldownInfo(c)

      if (customerFilter === "active") return !isExpired && !c.isBlocked
      if (customerFilter === "expired") return isExpired
      if (customerFilter === "cooldown") return cooldownInfo.isMonthlyMax
      if (customerFilter === "blocked") return c.isBlocked

      return true
    })
  }, [customers, searchQuery, customerFilter, settings])

  // Customer Form submission (Add or Edit)
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError("")

    if (!/^[6-9]\d{9}$/.test(custMobile.replace(/\D/g, ""))) {
      setFormError("Enter a valid 10-digit Indian mobile number")
      return
    }

    try {
      const res = await fetch("/api/admin/customer", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: editingCustomer ? editingCustomer.id : undefined,
          mobile: custMobile,
          service: custService,
          subscriptionDate: custSubDate,
          validity: custValidity,
          expiryDate: custExpDate,
          assignedAccountId: custAssignedAcc || null,
          isBlocked: custBlocked,
        }),
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        setShowAddCustomerModal(false)
        setEditingCustomer(null)
        if (token) fetchAdminData(token)
      } else {
        setFormError(data.message || "Failed to save customer")
      }
    } catch {
      setFormError("Network error")
    }
  }

  // Delete customer
  const handleDeleteCustomer = async (id: string) => {
    if (!confirm("Are you sure you want to delete this customer?")) return
    try {
      await fetch(`/api/admin/customer?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      })
      if (token) fetchAdminData(token)
    } catch {
      alert("Failed to delete customer")
    }
  }

  // Reset Cooldown / Allow immediate attempt
  const handleResetCooldown = async (id: string) => {
    try {
      const res = await fetch("/api/admin/reset-counter", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ customerId: id }),
      })
      const data = await res.json()
      if (data.ok) {
        if (token) fetchAdminData(token)
      }
    } catch {
      alert("Failed to reset cooldown")
    }
  }

  // Toggle Block customer
  const handleToggleBlock = async (c: Customer) => {
    try {
      await fetch("/api/admin/customer", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ id: c.id, isBlocked: !c.isBlocked }),
      })
      if (token) fetchAdminData(token)
    } catch {
      alert("Failed to update status")
    }
  }

  // Open Edit Customer modal
  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c)
    setCustMobile(c.mobile)
    setCustService(c.service)
    setCustSubDate(c.subscriptionDate)
    setCustValidity(c.validity)
    setCustExpDate(c.expiryDate)
    setCustAssignedAcc(c.assignedAccountId || "")
    setCustBlocked(c.isBlocked)
    setFormError("")
    setShowAddCustomerModal(true)
  }

  // Open Add Customer modal
  const openAddCustomer = () => {
    setEditingCustomer(null)
    setCustMobile("")
    setCustService("Netflix 4K")
    const today = new Date().toISOString().slice(0, 10)
    setCustSubDate(today)
    setCustValidity("1 Month")
    setCustExpDate(calculateExpiryDate(today, "1 Month"))
    setCustAssignedAcc(netflixCookies[0]?.id || "")
    setCustBlocked(false)
    setFormError("")
    setShowAddCustomerModal(true)
  }

  // Bulk Import text change
  const handleBulkTextChange = (text: string) => {
    setBulkText(text)
    const parsed = parseBulkSubscribers(text)
    setBulkPreview(parsed)
  }

  // Direct CSV file upload handler
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const content = evt.target?.result as string
      if (!content) return
      setBulkText(content)
      const parsed = parseBulkSubscribers(content)
      setBulkPreview(parsed)
      setShowBulkImportModal(true)
      setBulkMessage(`Loaded "${file.name}" — detected ${parsed.length} customer records. Review below and click Import.`)
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  const handleExecuteBulkImport = async () => {
    if (!bulkPreview.length) return
    setBulkMessage("Importing...")
    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-admin-token": token || "",
        },
        body: JSON.stringify({ rows: bulkPreview }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBulkMessage(data.message)
        setTimeout(() => {
          setShowBulkImportModal(false)
          setBulkText("")
          setBulkPreview([])
          setBulkMessage("")
          if (token) fetchAdminData(token)
        }, 1200)
      } else {
        setBulkMessage(data.message || "Failed to import rows")
      }
    } catch {
      setBulkMessage("Network error during import")
    }
  }

  // Export Customers to CSV
  const handleExportCsv = () => {
    const headers = "Mobile,Service,Subscription Date,Validity,Expiry Date,Assigned Account,Total Updates,Status\n"
    const rows = customers.map((c) => {
      const acc = netflixCookies.find((a) => a.id === c.assignedAccountId)
      const accName = acc ? acc.accountLabel || acc.profileName : "Pool Default"
      const status = c.isBlocked ? "Blocked" : c.expiryDate < new Date().toISOString().slice(0, 10) ? "Expired" : "Active"
      return `${c.mobile},"${c.service}",${c.subscriptionDate},"${c.validity}",${c.expiryDate},"${accName}",${c.totalUpdates},${status}`
    }).join("\n")

    const blob = new Blob([headers + rows], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `netflix_customers_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  // Netflix Cookie Actions
  const handleSaveCookie = async (e: React.FormEvent) => {
    e.preventDefault()
    setCookieError("")

    try {
      const res = await fetch("/api/admin/cookies", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: editingCookie ? editingCookie.id : undefined,
          profileName: cookieProfileName || "Netflix Account",
          accountLabel: cookieProfileName || "Netflix Account",
          accountEmail: cookieEmail,
          cookiesRaw: cookieRawJson,
          userAgent: cookieUserAgent || (typeof navigator !== "undefined" && !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? navigator.userAgent : ""),
        }),
      })

      const data = await res.json()
      if (res.ok && data.ok) {
        setShowAddCookieModal(false)
        setEditingCookie(null)
        setCookieProfileName("")
        setCookieEmail("")
        setCookieRawJson("")
        setCookieUserAgent("")
        if (token) fetchAdminData(token)
      } else {
        setCookieError(data.message || "Failed to save cookies")
      }
    } catch {
      setCookieError("Network error")
    }
  }

  const handleDeleteCookie = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Netflix account from the vault?")) return
    try {
      await fetch(`/api/admin/cookies?id=${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      })
      if (token) fetchAdminData(token)
    } catch {
      alert("Failed to delete account")
    }
  }

  // Live Test Cookies Button
  const handleTestCookie = async (id: string) => {
    setTestingCookieId(id)
    try {
      const res = await fetch("/api/admin/test-cookies", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ accountId: id }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        if (token) fetchAdminData(token)
      } else {
        alert(data.message || "Test failed")
      }
    } catch {
      alert("Network error testing cookies")
    } finally {
      setTestingCookieId(null)
    }
  }

  // Test All Cookies Button
  const handleTestAllCookies = async () => {
    setTestingAllCookies(true)
    try {
      const res = await fetch("/api/admin/test-all-cookies", {
        method: "POST",
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        if (token) fetchAdminData(token)
        alert(`Tested ${data.total} account(s): ${data.working} working.`)
      }
    } catch {
      alert("Error testing accounts")
    } finally {
      setTestingAllCookies(false)
    }
  }

  // Settings Save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSettingsSuccess("")
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ maxUpdatesPerMonth: parseInt(maxUpdates, 10) }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        setSettingsSuccess("Settings saved successfully!")
        if (token) fetchAdminData(token)
      } else {
        alert(data.message || "Failed to save settings")
      }
    } catch {
      alert("Failed to save settings")
    }
  }

  // Database Backup / Export JSON
  const handleDownloadBackup = () => {
    const fullBackup = {
      customers,
      netflixCookies,
      settings,
      activationsLog,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `screenhub_netflix_database_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  // Database Restore
  const handleRestoreBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string)
        if (!parsed.customers || !Array.isArray(parsed.customers)) {
          alert("Invalid backup file format")
          return
        }
        const res = await fetch("/api/admin/data", {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ restoreData: parsed }),
        })
        const data = await res.json()
        if (res.ok && data.ok) {
          alert("Database successfully restored!")
          if (token) fetchAdminData(token)
        } else {
          alert(data.message || "Failed to restore database")
        }
      } catch {
        alert("Could not parse JSON backup file")
      }
    }
    reader.readAsText(file)
  }

  // IF NOT AUTHENTICATED -> SHOW LOGIN GATE
  if (!token) {
    return (
      <div className="min-h-screen bg-netflix-dark flex items-center justify-center p-4 relative font-sans">
        <div className="absolute inset-0 bg-gradient-to-br from-netflix-dark via-netflix-darker to-black opacity-80" />
        <Card className="relative z-10 w-full max-w-sm bg-netflix-card border-netflix-border p-6 rounded-xl shadow-2xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-netflix-red/20 rounded-full flex items-center justify-center mx-auto text-netflix-red">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white">Admin Console</h1>
            <p className="text-netflix-muted text-xs">Enter your administrator passcode</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Passcode"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="bg-netflix-input border-netflix-border text-white placeholder:text-netflix-muted h-12 text-center text-lg tracking-widest"
                autoFocus
              />
              {loginError && <p className="text-red-500 text-xs text-center">{loginError}</p>}
            </div>

            <Button
              type="submit"
              className="w-full bg-netflix-red hover:bg-netflix-red-hover text-white font-semibold h-11 rounded-lg"
            >
              Sign In
            </Button>
          </form>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-netflix-dark text-netflix-light flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-netflix-border bg-netflix-card/60 backdrop-blur sticky top-0 z-30 px-3 md:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-netflix-red flex items-center justify-center font-bold text-white text-base shrink-0">
            S
          </div>
          <div>
            <h1 className="font-bold text-white text-sm md:text-base leading-tight">
              ScreenHub Digital Services
              {build && (
                <span
                  className="ml-2 align-middle text-[10px] font-mono font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5"
                  title={build.commit ? `Deployed from commit ${build.commit}` : "Running version"}
                >
                  v{build.version}
                  {build.commit ? ` · ${build.commit}` : ""}
                </span>
              )}
            </h1>
            <p className="text-netflix-muted text-[11px] hidden sm:block">Netflix Customer & TV Code Admin Portal</p>
          </div>
        </div>

        {/* Tab switcher */}
        <nav className="hidden md:flex items-center gap-1 bg-netflix-dark/80 p-1 rounded-xl border border-netflix-border">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "dashboard" ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
            }`}
          >
            <Activity className="w-3.5 h-3.5" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab("customers")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "customers" ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Customers ({customers.length})
          </button>
          <button
            onClick={() => setActiveTab("cookies")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "cookies" ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
            }`}
          >
            <Cookie className="w-3.5 h-3.5" /> Netflix Cookie Vault ({netflixCookies.length})
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "logs" ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
            }`}
          >
            <Tv className="w-3.5 h-3.5" /> Activity Logs
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "settings" ? "bg-netflix-red text-white" : "text-netflix-gray hover:text-white"
            }`}
          >
            <Settings className="w-3.5 h-3.5" /> Settings
          </button>
        </nav>

        <div className="flex items-center gap-2.5">
          {storageInfo?.isPersistent ? (
            <div
              className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
              title={storageInfo.details || "Connected to persistent database"}
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{storageInfo.label || "Supabase (permanent)"}</span>
            </div>
          ) : (
            <div
              className="bg-red-500/15 text-red-300 border border-red-500/40 px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm"
              title={storageInfo?.details || storageError || "Storage status unknown"}
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{storageInfo ? "Storage error" : "Checking storage..."}</span>
            </div>
          )}

          <Button
            onClick={() => window.open("/", "_blank")}
            variant="outline"
            className="hidden md:inline-flex border-netflix-border text-netflix-gray hover:text-white text-xs h-8 px-2.5 bg-transparent cursor-pointer"
          >
            Open Public Site
          </Button>
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="text-netflix-muted hover:text-red-400 text-xs h-8 px-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4 md:mr-1" /> <span className="hidden md:inline">Logout</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-3 md:p-6 pb-28 md:pb-6 max-w-7xl w-full mx-auto space-y-6">
        {loading && (
          <div className="flex items-center justify-center py-24 text-netflix-muted gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-netflix-red" />
            <span>Loading admin database...</span>
          </div>
        )}

        {!loading && (
          <>
            {/* 1. DASHBOARD TAB */}
            {storageError && (
              <div className="mb-4 bg-red-950/50 border border-red-700/60 rounded-xl p-4 text-sm text-red-200 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-red-300">Storage error: data could not be loaded from Supabase</p>
                  <p className="text-xs text-red-200/80 font-mono break-all">{storageError}</p>
                  <p className="text-xs text-red-200/70">
                    Nothing is shown below until the database is reachable, so no data is lost or overwritten. Check the Supabase
                    environment variables in Vercel and that the migration has been run.
                  </p>
                </div>
              </div>
            )}

            {!storageError && activeTab === "dashboard" && (
              <div className="space-y-6 animate-fade-in">
                {/* Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Total Subscribers</p>
                    <p className="text-3xl font-bold text-white">{metrics?.totalSubscribers ?? customers.length}</p>
                    <p className="text-green-400 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {metrics?.activeSubscribers ?? 0} active subscriptions
                    </p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Expired Subscribers</p>
                    <p className="text-3xl font-bold text-yellow-400">{metrics?.expiredSubscribers ?? 0}</p>
                    <p className="text-netflix-muted text-xs">Need renewal or validity update</p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Updates This Month</p>
                    <p className="text-3xl font-bold text-netflix-red">{metrics?.activationsMonth ?? 0}</p>
                    <p className="text-netflix-muted text-xs">Today: {metrics?.activationsToday ?? 0} attempts</p>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-4 rounded-xl space-y-1">
                    <p className="text-netflix-muted text-xs font-medium uppercase tracking-wider">Netflix Accounts Vault</p>
                    <p className="text-3xl font-bold text-white">{netflixCookies.length}</p>
                    <p className="text-green-400 text-xs flex items-center gap-1">
                      <Shield className="w-3 h-3" /> {metrics?.activeCookies ?? 0} accounts live & working
                    </p>
                  </Card>
                </div>

                {/* Quick Shortcuts */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      <Users className="w-4 h-4 text-netflix-red" /> Customer Management Quick Actions
                    </h3>
                    <p className="text-netflix-muted text-xs">
                      Easily add new customers or bulk paste rows from your Google Sheets.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={openAddCustomer}
                        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Customer
                      </Button>
                      <Button
                        onClick={() => setShowBulkImportModal(true)}
                        variant="outline"
                        className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Import from Sheet
                      </Button>
                    </div>
                  </Card>

                  <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                    <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                      <Cookie className="w-4 h-4 text-netflix-red" /> Netflix Session Health Check
                    </h3>
                    <p className="text-netflix-muted text-xs">
                      Verify if your pooled Netflix cookies are valid and authenticated.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleTestAllCookies}
                        disabled={testingAllCookies || netflixCookies.length === 0}
                        className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                      >
                        {testingAllCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                        Test All Netflix Accounts
                      </Button>
                      <Button
                        onClick={() => {
                          setEditingCookie(null)
                          setCookieProfileName("")
                          setCookieEmail("")
                          setCookieRawJson("")
                          setCookieError("")
                          setShowAddCookieModal(true)
                        }}
                        variant="outline"
                        className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Account Cookies
                      </Button>
                    </div>
                  </Card>
                </div>

                {/* Recent Activity summary */}
                <Card className="bg-netflix-card border-netflix-border p-5 rounded-xl space-y-3">
                  <h3 className="font-semibold text-white text-sm">Recent TV Logins & Updates</h3>
                  {activationsLog.length === 0 ? (
                    <p className="text-netflix-muted text-xs py-4 text-center">No login attempts recorded yet</p>
                  ) : (
                    <div className="divide-y divide-netflix-border/50">
                      {activationsLog.slice(0, 5).map((l) => (
                        <div key={l.id} className="py-2.5 flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white">+91 {l.mobile}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                              l.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                            }`}>
                              {l.action === "tv_login" ? "TV Login" : "Household Update"}
                            </span>
                            {l.code && <span className="font-mono text-netflix-muted">Code: {l.code}</span>}
                          </div>
                          <span className="text-netflix-muted">{new Date(l.timestamp).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* 2. CUSTOMERS TAB */}
            {!storageError && activeTab === "customers" && (
              <div className="space-y-4 animate-fade-in">
                {/* Search & Actions Bar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 lg:max-w-2xl">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-netflix-muted absolute left-3 top-1/2 -translate-y-1/2" />
                      <Input
                        placeholder="Search by mobile or service..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-netflix-input border-netflix-border pl-9 h-10 text-xs text-white"
                      />
                    </div>
                    {/* Status filters */}
                    <div className="flex items-center gap-1 bg-netflix-card p-1 rounded-lg border border-netflix-border text-xs overflow-x-auto">
                      {(["all", "active", "expired", "cooldown", "blocked"] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setCustomerFilter(f)}
                          className={`px-2.5 py-1.5 rounded text-[11px] font-medium capitalize cursor-pointer transition-colors whitespace-nowrap ${
                            customerFilter === f ? "bg-netflix-red text-white" : "text-netflix-muted hover:text-white"
                          }`}
                        >
                          {f === "cooldown" ? "limit reached" : f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={openAddCustomer}
                      className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Customer
                    </Button>
                    <label className="border border-netflix-red/60 bg-netflix-red/10 hover:bg-netflix-red hover:text-white text-netflix-red text-xs h-10 px-3 rounded-md inline-flex items-center gap-1.5 cursor-pointer transition-colors font-medium">
                      <Upload className="w-3.5 h-3.5" /> Upload CSV
                      <input type="file" accept=".csv,.txt" onChange={handleCsvFileUpload} className="hidden" />
                    </label>
                    <Button
                      onClick={() => setShowBulkImportModal(true)}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Paste Sheet
                    </Button>
                    <Button
                      onClick={handleExportCsv}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                    </Button>
                  </div>
                </div>

                {/* Customers: phone cards */}
                <div className="md:hidden space-y-3">
                  <p className="text-netflix-muted text-[11px] px-1">
                    {filteredCustomers.length} of {customers.length} customers
                  </p>
                  {filteredCustomers.length === 0 ? (
                    <Card className="bg-netflix-card border-netflix-border rounded-xl p-6 text-center text-netflix-muted text-xs">
                      No customer records found
                    </Card>
                  ) : (
                    filteredCustomers.map((c) => {
                      const today = new Date().toISOString().slice(0, 10)
                      const isExpired = c.expiryDate && c.expiryDate < today
                      const cooldown = getCustomerCooldownInfo(c)
                      const assigned = netflixCookies.find((a) => a.id === c.assignedAccountId)
                      return (
                        <Card key={c.id} className="bg-netflix-card border-netflix-border rounded-xl p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <a href={`tel:+91${c.mobile}`} className="font-mono font-semibold text-white text-base">
                                +91 {c.mobile}
                              </a>
                              <p className="text-netflix-muted text-[11px]">
                                {c.service} · {c.validity}
                              </p>
                            </div>
                            {c.isBlocked ? (
                              <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">Blocked</span>
                            ) : isExpired ? (
                              <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">Expired</span>
                            ) : cooldown.isMonthlyMax ? (
                              <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-[11px] font-medium">Limit used</span>
                            ) : (
                              <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-[11px] font-medium">Ready</span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-netflix-dark/60 rounded-lg p-2">
                              <p className="text-netflix-muted">Expires</p>
                              <p className={isExpired ? "text-red-400 font-semibold" : "text-white"}>
                                {formatDisplayDate(c.expiryDate)}
                              </p>
                            </div>
                            <div className="bg-netflix-dark/60 rounded-lg p-2">
                              <p className="text-netflix-muted">TV logins this month</p>
                              <p className={cooldown.isMonthlyMax ? "text-yellow-400 font-bold" : "text-white"}>
                                {cooldown.monthUsed}/{cooldown.max}
                                <span className="text-netflix-muted"> (total {c.totalUpdates || 0})</span>
                              </p>
                            </div>
                            <div className="bg-netflix-dark/60 rounded-lg p-2 col-span-2">
                              <p className="text-netflix-muted">Netflix account</p>
                              <p className="text-white truncate">
                                {assigned ? assigned.accountLabel || assigned.profileName : "Pool default (auto-assigned)"}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2">
                            <Button
                              onClick={() => openEditCustomer(c)}
                              variant="outline"
                              className="h-10 border-netflix-border text-white bg-transparent text-[11px] px-0 cursor-pointer"
                            >
                              <Edit className="w-4 h-4 mr-1" /> Edit
                            </Button>
                            <Button
                              onClick={() => setSelectedCustomerHistory(c)}
                              variant="outline"
                              className="h-10 border-netflix-border text-white bg-transparent text-[11px] px-0 cursor-pointer"
                            >
                              <Activity className="w-4 h-4 mr-1" /> Log
                            </Button>
                            <Button
                              onClick={() => handleToggleBlock(c)}
                              variant="outline"
                              className={`h-10 bg-transparent text-[11px] px-0 cursor-pointer ${
                                c.isBlocked ? "border-red-500/50 text-red-400" : "border-netflix-border text-white"
                              }`}
                            >
                              <Shield className="w-4 h-4 mr-1" /> {c.isBlocked ? "Unblock" : "Block"}
                            </Button>
                            <Button
                              onClick={() => handleDeleteCustomer(c.id)}
                              variant="outline"
                              className="h-10 border-netflix-border text-red-400 bg-transparent text-[11px] px-0 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                          {cooldown.isMonthlyMax && (
                            <Button
                              onClick={() => handleResetCooldown(c.id)}
                              variant="outline"
                              className="w-full h-10 border-yellow-500/40 text-yellow-400 bg-transparent text-xs cursor-pointer"
                            >
                              Reset monthly TV limit
                            </Button>
                          )}
                        </Card>
                      )
                    })
                  )}
                </div>

                {/* Customers Table */}
                <Card className="hidden md:block bg-netflix-card border-netflix-border rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                        <tr>
                          <th className="py-3 px-4">Customer Mobile</th>
                          <th className="py-3 px-4">Plan & Validity</th>
                          <th className="py-3 px-4">Sub. Date</th>
                          <th className="py-3 px-4">Expiry Date</th>
                          <th className="py-3 px-4">Assigned Account</th>
                          <th className="py-3 px-4">Usage Counter</th>
                          <th className="py-3 px-4">Status / Cooldown</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                        {filteredCustomers.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-netflix-muted">
                              No customer records found
                            </td>
                          </tr>
                        ) : (
                          filteredCustomers.map((c) => {
                            const today = new Date().toISOString().slice(0, 10)
                            const isExpired = c.expiryDate && c.expiryDate < today
                            const cooldown = getCustomerCooldownInfo(c)
                            const assigned = netflixCookies.find((a) => a.id === c.assignedAccountId)

                            return (
                              <tr key={c.id} className="hover:bg-netflix-input/30 transition-colors">
                                <td className="py-3 px-4 font-mono font-medium text-white">
                                  +91 {c.mobile}
                                </td>
                                <td className="py-3 px-4">
                                  <span className="text-white font-medium block">{c.service}</span>
                                  <span className="text-netflix-muted text-[11px]">{c.validity}</span>
                                </td>
                                <td className="py-3 px-4 text-netflix-muted">
                                  {formatDisplayDate(c.subscriptionDate)}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-1.5">
                                    <span className={isExpired ? "text-red-400 font-semibold" : "text-white"}>
                                      {formatDisplayDate(c.expiryDate)}
                                    </span>
                                    {isExpired ? (
                                      <span className="bg-red-500/20 text-red-400 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                        Expired
                                      </span>
                                    ) : (
                                      <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded font-medium">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {assigned ? (
                                    <span className="text-white bg-netflix-dark px-2 py-0.5 rounded border border-netflix-border text-[11px]">
                                      {assigned.accountLabel || assigned.profileName}
                                    </span>
                                  ) : (
                                    <span className="text-netflix-muted italic text-[11px]">Pool Default</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5 font-mono">
                                      <span className={cooldown.isMonthlyMax ? "text-yellow-400 font-bold" : "text-white"}>
                                        {cooldown.monthUsed}/{cooldown.max} TV
                                      </span>
                                      <span className="text-netflix-muted text-[10px]">
                                        (Total: {c.totalUpdates || 0})
                                      </span>
                                    </div>
                                    <div className="w-16 h-1.5 bg-netflix-dark rounded-full overflow-hidden">
                                      <div
                                        className={`h-full ${cooldown.isMonthlyMax ? "bg-yellow-500" : "bg-netflix-red"}`}
                                        style={{ width: `${Math.min(100, (cooldown.monthUsed / cooldown.max) * 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {c.isBlocked ? (
                                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">
                                      Blocked
                                    </span>
                                  ) : isExpired ? (
                                    <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-[11px] font-semibold">
                                      Expired
                                    </span>
                                  ) : cooldown.isMonthlyMax ? (
                                    <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded text-[11px] font-medium">
                                      TV limit used this month
                                    </span>
                                  ) : (
                                    <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 w-fit">
                                      <CheckCircle2 className="w-3 h-3" /> Ready
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {cooldown.isMonthlyMax && (
                                      <Button
                                        onClick={() => handleResetCooldown(c.id)}
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px] px-2 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 cursor-pointer"
                                        title="Give this customer a full TV login allowance again from now"
                                      >
                                        Reset Limit
                                      </Button>
                                    )}

                                    <button
                                      onClick={() => setSelectedCustomerHistory(c)}
                                      className="text-netflix-muted hover:text-white p-1 cursor-pointer"
                                      title="View usage history"
                                    >
                                      <Activity className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => handleToggleBlock(c)}
                                      className={`p-1 cursor-pointer ${c.isBlocked ? "text-red-400" : "text-netflix-muted hover:text-white"}`}
                                      title={c.isBlocked ? "Unblock access" : "Block access"}
                                    >
                                      <Shield className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => openEditCustomer(c)}
                                      className="text-netflix-muted hover:text-white p-1 cursor-pointer"
                                      title="Edit customer"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      onClick={() => handleDeleteCustomer(c.id)}
                                      className="text-netflix-muted hover:text-red-400 p-1 cursor-pointer"
                                      title="Delete customer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            {/* 3. NETFLIX COOKIE VAULT TAB */}
            {!storageError && activeTab === "cookies" && (
              <div className="space-y-4 animate-fade-in">
                {/* Storage & Auto-Keepalive Status Bar */}
                <div className="bg-netflix-card border border-netflix-border rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    {storageInfo?.isPersistent ? (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5" /> Storage: {storageInfo.label}
                      </span>
                    ) : (
                      <span
                        className="bg-red-500/15 text-red-300 border border-red-500/40 px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5"
                        title={storageInfo?.details || "Storage status unknown"}
                      >
                        <Database className="w-3.5 h-3.5" /> Storage: {storageInfo ? "error" : "checking..."}
                      </span>
                    )}
                    {storageInfo?.details && !storageInfo.isPersistent && (
                      <span className="text-[11px] text-red-300/80 font-mono">
                        ({storageInfo.details})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-netflix-muted font-mono text-[11px]">
                    <Clock className="w-3.5 h-3.5 text-netflix-light" />
                    <span>Auto-Keepalive: every 6h (GitHub Actions) + daily Vercel cron</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-white">Netflix Accounts & Session Vault</h2>
                    <p className="text-netflix-muted text-xs">
                      Sessions are preserved, bound to browser User-Agent, and automatically refreshed to stay alive.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleTestAllCookies}
                      disabled={testingAllCookies || netflixCookies.length === 0}
                      className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                    >
                      {testingAllCookies ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                      Test & Keep Alive All
                    </Button>
                    <Button
                      onClick={() => {
                        setEditingCookie(null)
                        setCookieProfileName("")
                        setCookieEmail("")
                        setCookieRawJson("")
                        setCookieUserAgent(typeof navigator !== "undefined" && !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? navigator.userAgent : "")
                        setCookieError("")
                        setShowAddCookieModal(true)
                      }}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-9 bg-transparent cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Account Cookies
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {netflixCookies.map((acc) => {
                    const isTesting = testingCookieId === acc.id
                    const assignedUsersCount = customers.filter((c) => c.assignedAccountId === acc.id).length
                    const isNeedsReimport = acc.status === "needs_reimport"
                    const isExpired = acc.status === "expired" || acc.lastResult === "expired"
                    const isExpiringSoon = acc.status === "expiring_soon"
                    const isUnverified = acc.status === "unverified"
                    const isLive = acc.status === "live"

                    return (
                      <Card
                        key={acc.id}
                        className={`bg-netflix-card border p-5 rounded-xl space-y-4 ${
                          isNeedsReimport
                            ? "border-red-500/70 shadow-lg shadow-red-950/20"
                            : isExpiringSoon
                            ? "border-amber-500/50"
                            : "border-netflix-border"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-bold text-white text-base">{acc.accountLabel || acc.profileName}</h3>
                            <p className="text-netflix-muted text-xs font-mono">{acc.accountEmail || "No email note"}</p>
                          </div>
                          {isLive ? (
                            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Live
                            </span>
                          ) : isExpiringSoon ? (
                            <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" /> Expiring Soon
                            </span>
                          ) : isNeedsReimport ? (
                            <span className="bg-red-500/25 text-red-400 border border-red-500/50 text-xs px-2.5 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse">
                              <AlertTriangle className="w-3.5 h-3.5" /> Needs Re-import
                            </span>
                          ) : isExpired ? (
                            <span className="bg-red-950/40 text-red-300 border border-red-800/40 text-xs px-2.5 py-0.5 rounded font-semibold flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5" /> Expired
                            </span>
                          ) : isUnverified ? (
                            <span
                              className="bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs px-2.5 py-0.5 rounded font-semibold"
                              title="Netflix could not be reached on the last check"
                            >
                              Unverified
                            </span>
                          ) : (
                            <span className="bg-yellow-500/20 text-yellow-400 text-xs px-2.5 py-0.5 rounded font-semibold">
                              Untested
                            </span>
                          )}
                        </div>

                        {isNeedsReimport && (
                          <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-2.5 text-xs text-red-200 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-semibold text-red-300">Session Invalidated by Netflix</p>
                              <p className="text-[11px] text-red-300/80">
                                Netflix redirected to login. Automatic keepalive cannot refresh this session. Please export fresh cookies and edit this account.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="bg-netflix-dark/60 border border-netflix-border/50 rounded-lg p-3 text-xs space-y-1.5">
                          <div className="flex justify-between">
                            <span className="text-netflix-muted">Cookies Count:</span>
                            <span className="text-white font-mono">{acc.cookies?.length || 0} cookies</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-netflix-muted">Assigned Customers:</span>
                            <span className="text-white font-mono">{assignedUsersCount} users</span>
                          </div>
                          {acc.earliestExpiryIso && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Token Expiry:</span>
                              <span
                                className={`font-mono ${
                                  isExpiringSoon ? "text-amber-300" : isExpired ? "text-red-400" : "text-netflix-light"
                                }`}
                              >
                                {new Date(acc.earliestExpiryIso).toLocaleDateString("en-IN")}
                              </span>
                            </div>
                          )}
                          {acc.lastCheckedAt && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Last Checked:</span>
                              <span className="text-netflix-light">
                                {new Date(acc.lastCheckedAt).toLocaleString("en-IN")}
                              </span>
                            </div>
                          )}
                          {acc.lastRefreshedAt && (
                            <div className="flex justify-between">
                              <span className="text-netflix-muted">Last Refreshed:</span>
                              <span className="text-emerald-400 font-medium">
                                {new Date(acc.lastRefreshedAt).toLocaleString("en-IN")}
                              </span>
                            </div>
                          )}
                          {acc.userAgent && (
                            <div className="flex justify-between items-center pt-1 border-t border-netflix-border/30 text-[11px]">
                              <span className="text-netflix-muted">Device:</span>
                              <span className="text-netflix-light font-mono truncate max-w-[170px]" title={acc.userAgent}>
                                {acc.userAgent.includes("Mac")
                                  ? "Chrome (macOS)"
                                  : acc.userAgent.includes("Windows")
                                  ? "Chrome (Windows)"
                                  : "Desktop Browser"}
                              </span>
                            </div>
                          )}
                          {acc.lastDetail && (
                            <p className="text-[11px] text-netflix-muted pt-1 border-t border-netflix-border/40">
                              {acc.lastDetail}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            onClick={() => handleTestCookie(acc.id)}
                            disabled={isTesting}
                            className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-9 cursor-pointer"
                          >
                            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                            Test & Keep Alive
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingCookie(acc)
                              setCookieProfileName(acc.profileName)
                              setCookieEmail(acc.accountEmail || "")
                              setCookieRawJson(JSON.stringify(acc.cookies, null, 2))
                              setCookieUserAgent(acc.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""))
                              setCookieError("")
                              setShowAddCookieModal(true)
                            }}
                            variant="outline"
                            className="border-netflix-border text-netflix-light hover:text-white text-xs h-9 bg-transparent cursor-pointer"
                            title="Edit account cookies"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            onClick={() => handleDeleteCookie(acc.id)}
                            variant="outline"
                            className="border-netflix-border text-netflix-muted hover:text-red-400 text-xs h-9 bg-transparent cursor-pointer"
                            title="Delete account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 4. ACTIVITY LOGS TAB */}
            {!storageError && activeTab === "logs" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Live Activity & Activation Log</h2>
                  <span className="text-netflix-muted text-xs">{activationsLog.length} total entries</span>
                </div>

                <div className="md:hidden space-y-2">
                  {activationsLog.length === 0 ? (
                    <Card className="bg-netflix-card border-netflix-border rounded-xl p-6 text-center text-netflix-muted text-xs">
                      No logs recorded yet
                    </Card>
                  ) : (
                    activationsLog.map((l) => (
                      <Card key={l.id} className="bg-netflix-card border-netflix-border rounded-xl p-3 space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-white">+91 {l.mobile}</span>
                          <span
                            className={`font-semibold ${
                              l.status === "success" ? "text-green-400" : l.status === "rate_limited" ? "text-yellow-400" : "text-red-400"
                            }`}
                          >
                            {l.status === "success"
                              ? "Success"
                              : l.status === "rate_limited"
                                ? "Limit reached"
                                : l.status === "blocked"
                                  ? "Blocked"
                                  : "Failed"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-netflix-muted">
                          <span>
                            {l.action === "tv_login" ? "TV Login" : "Household Update"}
                            {l.code ? ` · ${l.code}` : ""}
                          </span>
                          <span>{new Date(l.timestamp).toLocaleString("en-IN")}</span>
                        </div>
                        {l.notes && <p className="text-netflix-muted text-[10px] break-words">{l.notes}</p>}
                      </Card>
                    ))
                  )}
                </div>

                <Card className="hidden md:block bg-netflix-card border-netflix-border rounded-xl overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-netflix-dark/80 text-netflix-muted uppercase tracking-wider text-[10px] border-b border-netflix-border">
                      <tr>
                        <th className="py-3 px-4">Timestamp</th>
                        <th className="py-3 px-4">Mobile</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">TV Code</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Client IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-netflix-border/50 text-netflix-light">
                      {activationsLog.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-netflix-muted">
                            No logs recorded yet
                          </td>
                        </tr>
                      ) : (
                        activationsLog.map((l) => (
                          <tr key={l.id} className="hover:bg-netflix-input/30">
                            <td className="py-3 px-4 text-netflix-muted">{new Date(l.timestamp).toLocaleString("en-IN")}</td>
                            <td className="py-3 px-4 font-mono font-medium text-white">+91 {l.mobile}</td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                l.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                              }`}>
                                {l.action === "tv_login" ? "TV Login" : "Household Update"}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono">{l.code || "—"}</td>
                            <td className="py-3 px-4 max-w-xs">
                              <span
                                className={`font-medium ${
                                  l.status === "success"
                                    ? "text-green-400"
                                    : l.status === "rate_limited"
                                      ? "text-yellow-400"
                                      : "text-red-400"
                                }`}
                              >
                                {l.status === "success"
                                  ? "Success"
                                  : l.status === "rate_limited"
                                    ? "Limit reached"
                                    : l.status === "blocked"
                                      ? "Blocked"
                                      : "Failed"}
                              </span>
                              {l.notes && <p className="text-netflix-muted text-[10px] mt-0.5 break-words">{l.notes}</p>}
                            </td>
                            <td className="py-3 px-4 font-mono text-netflix-muted">{l.ip || "unknown"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {/* 5. SETTINGS TAB */}
            {!storageError && activeTab === "settings" && (
              <div className="space-y-6 max-w-2xl animate-fade-in">
                <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-5">
                  <h2 className="text-base font-bold text-white">General & Security Settings</h2>

                  <form onSubmit={handleSaveSettings} className="space-y-4">
                    <div className="bg-netflix-dark/60 border border-netflix-border/50 rounded-lg p-3 text-[11px] text-netflix-muted space-y-1">
                      <p>
                        <span className="text-netflix-light font-medium">Admin password:</span> set with the{" "}
                        <code className="font-mono">ADMIN_PASSWORD</code> environment variable in Vercel. Changing it signs out every admin session.
                      </p>
                      <p>
                        <span className="text-netflix-light font-medium">Support WhatsApp:</span> +91 97728 80079
                      </p>
                    </div>

                    <div className="space-y-1.5 max-w-xs">
                      <label className="text-xs font-medium text-netflix-light block">TV logins per customer per calendar month</label>
                      <Input
                        type="number"
                        value={maxUpdates}
                        onChange={(e) => setMaxUpdates(e.target.value)}
                        className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                        min={1}
                      />
                      <p className="text-[11px] text-netflix-muted">Default: 2. Household updates are unlimited.</p>
                    </div>

                    {settingsSuccess && <p className="text-green-400 text-xs font-medium">{settingsSuccess}</p>}

                    <Button type="submit" className="bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                      Save Settings
                    </Button>
                  </form>
                </Card>

                {/* Database Backup & Restore */}
                <Card className="bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4">
                  <h2 className="text-base font-bold text-white">Database Backup & Portability</h2>
                  <p className="text-netflix-muted text-xs leading-relaxed">
                    Download a full JSON snapshot of your customer database, Netflix cookie vault, and activity logs.
                    You can restore it on any deployment with 1 click.
                  </p>
                  <div className="flex gap-3">
                    <Button
                      onClick={handleDownloadBackup}
                      variant="outline"
                      className="border-netflix-border text-white hover:bg-netflix-input text-xs h-10 bg-transparent cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" /> Download Database Backup (JSON)
                    </Button>

                    <label className="border border-netflix-border text-white hover:bg-netflix-input text-xs h-10 px-4 rounded-md inline-flex items-center gap-1.5 cursor-pointer bg-transparent transition-colors">
                      <Upload className="w-3.5 h-3.5" /> Restore Database
                      <input type="file" accept=".json" onChange={handleRestoreBackup} className="hidden" />
                    </label>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </main>

      {/* Phone: floating "add customer" button */}
      {!loading && !storageError && (activeTab === "customers" || activeTab === "dashboard") && (
        <button
          onClick={openAddCustomer}
          className="md:hidden fixed right-4 bottom-20 z-40 w-14 h-14 rounded-full bg-netflix-red text-white shadow-lg shadow-black/50 flex items-center justify-center cursor-pointer"
          aria-label="Add customer"
        >
          <Plus className="w-6 h-6" />
        </button>
      )}

      {/* Phone: bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-netflix-card/95 backdrop-blur border-t border-netflix-border grid grid-cols-5"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {(
          [
            ["dashboard", Activity, "Home"],
            ["customers", Users, "Customers"],
            ["cookies", Cookie, "Cookies"],
            ["logs", Tv, "Logs"],
            ["settings", Settings, "Settings"],
          ] as const
        ).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-2.5 flex flex-col items-center gap-0.5 text-[10px] font-medium cursor-pointer ${
              activeTab === tab ? "text-netflix-red" : "text-netflix-muted"
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        ))}
      </nav>

      {/* MODAL 1: ADD / EDIT CUSTOMER */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">
                {editingCustomer ? "Edit Customer" : "Add New Customer"}
              </h3>
              <button
                onClick={() => setShowAddCustomerModal(false)}
                className="text-netflix-muted hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Mobile Number (10 Digits)</label>
                <Input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={custMobile}
                  onChange={(e) => setCustMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="bg-netflix-input border-netflix-border text-white font-mono text-sm h-10"
                  maxLength={10}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Plan / Service</label>
                <Input
                  type="text"
                  placeholder="Netflix 4K Ultra"
                  value={custService}
                  onChange={(e) => setCustService(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-netflix-light font-medium block">Date of Subscription</label>
                  <Input
                    type="date"
                    value={custSubDate}
                    onChange={(e) => setCustSubDate(e.target.value)}
                    className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-netflix-light font-medium block">Validity Sold</label>
                  <select
                    value={custValidity}
                    onChange={(e) => setCustValidity(e.target.value)}
                    className="w-full bg-netflix-input border border-netflix-border text-white rounded-md text-xs h-10 px-2"
                  >
                    <option value="1 Month">1 Month (30 Days)</option>
                    <option value="2 Months">2 Months</option>
                    <option value="3 Months">3 Months</option>
                    <option value="6 Months">6 Months</option>
                    <option value="1 Year">1 Year (365 Days)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium flex items-center justify-between">
                  <span>Date of Expiry</span>
                  <span className="text-[10px] text-green-400">Automatically connected</span>
                </label>
                <Input
                  type="date"
                  value={custExpDate}
                  onChange={(e) => setCustExpDate(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white font-mono text-xs h-10"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Assign Netflix Account (Optional)</label>
                <select
                  value={custAssignedAcc}
                  onChange={(e) => setCustAssignedAcc(e.target.value)}
                  className="w-full bg-netflix-input border border-netflix-border text-white rounded-md text-xs h-10 px-2"
                >
                  <option value="">Auto / Pool Default</option>
                  {netflixCookies.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountLabel || a.profileName} ({a.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="blockCheck"
                  checked={custBlocked}
                  onChange={(e) => setCustBlocked(e.target.checked)}
                  className="rounded border-netflix-border text-netflix-red focus:ring-netflix-red"
                />
                <label htmlFor="blockCheck" className="text-xs text-netflix-light cursor-pointer">
                  Block user access immediately
                </label>
              </div>

              {formError && <p className="text-red-400 text-xs">{formError}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                  {editingCustomer ? "Update Customer" : "Add Customer"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  variant="outline"
                  className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 2: BULK IMPORT FROM SHEET */}
      {showBulkImportModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Bulk Import Customers from Sheet</h3>
                <p className="text-netflix-muted text-xs">
                  Copy and paste columns directly from Excel or Google Sheets (Mobile, Subscription Date, Validity).
                </p>
              </div>
              <button
                onClick={() => setShowBulkImportModal(false)}
                className="text-netflix-muted hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="border-2 border-dashed border-netflix-border hover:border-netflix-red/60 rounded-xl p-4 flex items-center justify-center gap-3 cursor-pointer bg-netflix-dark/50 hover:bg-netflix-dark/80 transition-all text-center">
                <div className="w-10 h-10 rounded-full bg-netflix-red/10 text-netflix-red flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-white">Click to Select CSV File</p>
                  <p className="text-[11px] text-netflix-muted">Upload any .csv exported from Google Sheets or Excel</p>
                </div>
                <input type="file" accept=".csv,.txt" onChange={handleCsvFileUpload} className="hidden" />
              </label>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-netflix-border/60 w-full" />
                <span className="bg-netflix-card px-3 text-[11px] text-netflix-muted uppercase tracking-wider absolute">Or paste rows directly</span>
              </div>

              <textarea
                rows={4}
                placeholder={`Paste your rows here, e.g.:
01/06/2026  9876543210  1 Month
9748521263  2026-06-07  6 Months`}
                value={bulkText}
                onChange={(e) => handleBulkTextChange(e.target.value)}
                className="w-full bg-netflix-input border border-netflix-border rounded-lg p-3 text-xs text-white font-mono placeholder:text-netflix-muted"
              />
              <p className="text-[11px] text-netflix-muted">
                Recognizes 10-digit mobile numbers, dates (DD/MM/YYYY or YYYY-MM-DD), and validity (1 Month, 6 Months, 1 Year).
                Expiry dates are calculated automatically!
              </p>
            </div>

            {bulkPreview.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-white">Parsed Preview ({bulkPreview.length} customers):</p>
                <div className="max-h-40 overflow-y-auto border border-netflix-border rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-netflix-dark text-netflix-muted text-[10px] uppercase">
                      <tr>
                        <th className="p-2">Mobile</th>
                        <th className="p-2">Start Date</th>
                        <th className="p-2">Validity</th>
                        <th className="p-2">Auto Expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-netflix-border/40">
                      {bulkPreview.map((r, i) => (
                        <tr key={i} className="font-mono text-[11px]">
                          <td className="p-2 text-white">+91 {r.mobile}</td>
                          <td className="p-2 text-netflix-muted">{r.subscriptionDate}</td>
                          <td className="p-2 text-netflix-light">{r.validity}</td>
                          <td className="p-2 text-green-400 font-semibold">{r.expiryDate}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {bulkMessage && <p className="text-xs text-yellow-400">{bulkMessage}</p>}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleExecuteBulkImport}
                disabled={!bulkPreview.length}
                className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer"
              >
                Import {bulkPreview.length} Customers
              </Button>
              <Button
                onClick={() => setShowBulkImportModal(false)}
                variant="outline"
                className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 3: ADD / EDIT NETFLIX COOKIES */}
      {showAddCookieModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">
                {editingCookie ? "Update Netflix Cookies" : "Add Netflix Account Cookies"}
              </h3>
              <button
                onClick={() => setShowAddCookieModal(false)}
                className="text-netflix-muted hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCookie} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Account Name / Label</label>
                <Input
                  type="text"
                  placeholder="e.g. Netflix 4K Account 1"
                  value={cookieProfileName}
                  onChange={(e) => setCookieProfileName(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Account Email / Note (Optional)</label>
                <Input
                  type="email"
                  placeholder="e.g. admin@screenhub.digital"
                  value={cookieEmail}
                  onChange={(e) => setCookieEmail(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-10"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-netflix-light font-medium block">Cookie JSON Export</label>
                <textarea
                  rows={8}
                  placeholder={`Paste JSON exported from Cookie-Editor / EditThisCookie:
[
  {
    "name": "NetflixId",
    "value": "...",
    "domain": ".netflix.com"
  },
  {
    "name": "SecureNetflixId",
    "value": "...",
    "domain": ".netflix.com"
  }
]`}
                  value={cookieRawJson}
                  onChange={(e) => setCookieRawJson(e.target.value)}
                  className="w-full bg-netflix-input border border-netflix-border rounded-lg p-2.5 text-xs text-white font-mono placeholder:text-netflix-muted"
                  required
                />
                <p className="text-[11px] text-netflix-muted">
                  Must include <span className="font-mono text-white">NetflixId</span> and <span className="font-mono text-white">SecureNetflixId</span> cookies.
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-netflix-light font-medium block">Bound Device User-Agent</label>
                  <button
                    type="button"
                    onClick={() => setCookieUserAgent(typeof navigator !== "undefined" && !/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? navigator.userAgent : "")}
                    className="text-[11px] text-netflix-red hover:underline cursor-pointer"
                  >
                    Auto-Detect Browser
                  </button>
                </div>
                <Input
                  type="text"
                  placeholder="e.g. Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)..."
                  value={cookieUserAgent}
                  onChange={(e) => setCookieUserAgent(e.target.value)}
                  className="bg-netflix-input border-netflix-border text-white text-xs h-9 font-mono"
                />
                <p className="text-[11px] text-netflix-muted">
                  Used for keepalive requests so Netflix sees the exact same browser/device footprint.
                </p>
              </div>

              {cookieError && <p className="text-red-400 text-xs">{cookieError}</p>}

              <div className="flex gap-2 pt-2">
                <Button type="submit" className="flex-1 bg-netflix-red hover:bg-netflix-red-hover text-white text-xs h-10 cursor-pointer">
                  {editingCookie ? "Update Account & Session" : "Save to Vault"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowAddCookieModal(false)}
                  variant="outline"
                  className="border-netflix-border text-netflix-gray hover:text-white text-xs h-10 bg-transparent cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 4: CUSTOMER HISTORY DETAIL */}
      {selectedCustomerHistory && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg bg-netflix-card border-netflix-border p-6 rounded-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Usage History: +91 {selectedCustomerHistory.mobile}</h3>
                <p className="text-netflix-muted text-xs">Total lifetime attempts: {selectedCustomerHistory.totalUpdates}</p>
              </div>
              <button
                onClick={() => setSelectedCustomerHistory(null)}
                className="text-netflix-muted hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              {(!selectedCustomerHistory.history || selectedCustomerHistory.history.length === 0) ? (
                <p className="text-netflix-muted text-xs py-6 text-center">No update or TV login history recorded yet</p>
              ) : (
                <div className="divide-y divide-netflix-border/50">
                  {selectedCustomerHistory.history.map((h, i) => (
                    <div key={i} className="py-2.5 text-xs flex justify-between items-center">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            h.action === "tv_login" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-400"
                          }`}>
                            {h.action === "tv_login" ? "TV Login" : "Household Update"}
                          </span>
                          {h.code && <span className="font-mono text-white">Code: {h.code}</span>}
                        </div>
                        {h.notes && <p className="text-netflix-muted text-[11px]">{h.notes}</p>}
                      </div>
                      <span className="text-netflix-muted font-mono">{new Date(h.date).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button
                onClick={() => setSelectedCustomerHistory(null)}
                className="w-full bg-netflix-input hover:bg-netflix-input/80 text-white text-xs h-9 cursor-pointer"
              >
                Close
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
