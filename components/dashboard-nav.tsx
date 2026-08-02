'use client'

import { createClient } from '@/lib/supabase/client'
import { startGlobalLoading } from '@/lib/global-loading'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggleShow,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  show: boolean
  onToggleShow: () => void
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full rounded-lg border border-border px-3 py-2 pr-10 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-foreground transition-colors"
          aria-label={show ? 'パスワードを隠す' : 'パスワードを表示'}
        >
          {show ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <path d="M1 1l22 22" />
              <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

export function DashboardNav({ userEmail }: { userEmail: string }) {
  const supabase = createClient()
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    if (!menuOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function openPasswordModal() {
    setMenuOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordSuccess('')
    setShowCurrentPassword(false)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    setPasswordModalOpen(true)
  }

  function closePasswordModal() {
    setPasswordModalOpen(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordSuccess('')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    startGlobalLoading()
    router.push('/login')
    router.refresh()
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')

    if (newPassword.length < 6) {
      setPasswordError('新しいパスワードは6文字以上にしてください。')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('新しいパスワードが一致しません。')
      return
    }

    setPasswordLoading(true)

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword,
    })

    if (verifyError) {
      setPasswordError('現在のパスワードが正しくありません。')
      setPasswordLoading(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setPasswordError(updateError.message)
      setPasswordLoading(false)
      return
    }

    setPasswordSuccess('パスワードを変更しました。')
    setPasswordLoading(false)
    setTimeout(() => closePasswordModal(), 1200)
  }

  return (
    <>
      <header className="border-b border-border bg-white print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link
            href="/projects"
            className="flex items-center gap-3 min-w-0"
            aria-label="トップへ"
          >
            <Image
              src="/logo.png"
              alt="サプロン建材工業株式会社"
              width={180}
              height={36}
              priority
              className="h-8 w-auto"
            />
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">
              鉄筋資材算定システム
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-gray-100 hover:text-foreground transition-colors"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                {userEmail}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-border bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={openPasswordModal}
                    className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-gray-50 transition-colors"
                  >
                    パスワード変更
                  </button>
                </div>
              )}
            </div>
            <Link
              href="/units"
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-gray-100 transition-colors"
            >
              ユニット管理
            </Link>
            <button
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-gray-100 transition-colors"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 print:hidden">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">パスワード変更</h3>
              <button
                type="button"
                onClick={closePasswordModal}
                className="text-sm text-muted hover:text-foreground"
              >
                閉じる
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4 p-5">
              <PasswordField
                id="current-password"
                label="現在のパスワード"
                value={currentPassword}
                onChange={setCurrentPassword}
                show={showCurrentPassword}
                onToggleShow={() => setShowCurrentPassword((v) => !v)}
              />
              <PasswordField
                id="new-password"
                label="新しいパスワード"
                value={newPassword}
                onChange={setNewPassword}
                show={showNewPassword}
                onToggleShow={() => setShowNewPassword((v) => !v)}
              />
              <PasswordField
                id="confirm-password"
                label="新しいパスワード（確認）"
                value={confirmPassword}
                onChange={setConfirmPassword}
                show={showConfirmPassword}
                onToggleShow={() => setShowConfirmPassword((v) => !v)}
              />

              {passwordError && (
                <p className="text-sm text-danger">{passwordError}</p>
              )}
              {passwordSuccess && (
                <p className="text-sm text-emerald-600">{passwordSuccess}</p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
                >
                  {passwordLoading ? '変更中...' : '変更する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
