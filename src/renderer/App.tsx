import { AppShell } from '@/components/shell/AppShell';
import QuickAddWindow from '@/components/shell/QuickAddWindow';

const isQuickAdd =
  new URLSearchParams(window.location.search).get('quick-add') === '1';

export default function App() {
  return isQuickAdd ? <QuickAddWindow /> : <AppShell />;
}
