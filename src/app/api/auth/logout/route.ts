import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer, REMEMBER_COOKIE, RECOVERY_COOKIE } from '@/lib/supabase';
import { sameOrigin, errorResponse } from '@/lib/auth';
import { HttpError } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) throw new HttpError(403, '허용되지 않은 요청입니다.');
    const supabase = await supabaseServer();
    await supabase.auth.signOut({ scope: 'local' });
    const store = await cookies();
    store.delete(REMEMBER_COOKIE);
    store.delete(RECOVERY_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
