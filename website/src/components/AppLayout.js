import React from 'react';
import TopNav from './TopNav';

function AppLayout({ currentUser, canAccessAdmin, onSignOut, children }) {
  return (
    <div className="min-h-screen bg-background font-inter">
      <TopNav currentUser={currentUser} canAccessAdmin={canAccessAdmin} onSignOut={onSignOut} />
      <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}

export default AppLayout;