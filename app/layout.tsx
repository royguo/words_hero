import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '词芽课堂 · Word Garden',
  description:
    '老师与孩子一起学习的本地单词课堂，支持 KET、PET 词汇，预制例句故事、构词学习、练习打印与课程回溯。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
