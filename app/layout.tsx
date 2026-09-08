import type { Metadata } from 'next';
import './globals.css';
import './study.css';
import './students.css';
import './classroom.css';
import { Toaster } from '@/components/ui/toast';
import { ResourceCacheInit } from './resource-cache-init';
export const metadata: Metadata = {
  title: '风筝单词 · KiteDance',
  icons: {
    icon: [{ url: '/favicon.png?v=2', type: 'image/png' }],
    apple: '/favicon.png?v=2',
  },
  description:
    '老师与孩子一起学习的互动单词课堂，支持 KET、PET 词汇，预制例句故事、构词学习、练习打印与课程回溯。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <ResourceCacheInit />
        <Toaster timeout={4000} limit={3}>
          {children}
        </Toaster>
      </body>
    </html>
  );
}
