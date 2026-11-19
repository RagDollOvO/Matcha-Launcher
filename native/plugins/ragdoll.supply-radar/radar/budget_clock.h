#pragma once
#include "win32.h"
namespace budget_clock {
inline long long Frequency(){static long long value=0;if(!value)QueryPerformanceFrequency(&value);return value;}
inline long long Now(){long long value=0;QueryPerformanceCounter(&value);return value;}
inline unsigned Microseconds(long long elapsed){return Frequency()?unsigned(double(elapsed)*1000000.0/double(Frequency())):0;}
// Convert once per work slice. Per-item checks still sample QPC, but compare
// integer ticks instead of repeatedly converting elapsed time to microseconds.
struct Budget {
    long long started,ticks;
    explicit Budget(unsigned microseconds):started(Now()),ticks(-1){
        long long frequency=Frequency();
        if(frequency>0){
            double count=double(frequency)*double(microseconds)/1000000.0;
            ticks=(long long)count;if(double(ticks)<count)++ticks;
        }
    }
    bool Expired()const {
        long long elapsed=Now()-started;
        // Keep sampling even if QPC's frequency is unavailable. As before,
        // the bounded item counts still apply without a usable time budget.
        return ticks>=0&&elapsed>=ticks;
    }
};
}
