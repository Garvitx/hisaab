export default function OpsLayout({ children }: LayoutProps<"/ops">) {
  return <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6">{children}</main>;
}
