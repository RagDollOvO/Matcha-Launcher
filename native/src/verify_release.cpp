#include "release_gate.hpp"
#include <iostream>
int wmain(int argc, wchar_t** argv) {
    try {
        beacon::require(argc==3 || argc==4,"Usage: beacon_verify <package> <trust-policy> [expected-release-sha256]");
        auto gate=beacon::verify(std::filesystem::absolute(argv[1]).lexically_normal(),argv[2],argc==4?l4p::utf8(argv[3]):"");
        std::cout << beacon::json{{"ok",true},{"verification",gate->report}}.dump() << '\n'; return 0;
    } catch(const std::exception& e) { std::cout << beacon::json{{"ok",false},{"error",{{"code","release_rejected"},{"message",e.what()}}}}.dump() << '\n'; return 1; }
}
