#include "common.hpp"
#include <iostream>
#include <utility>
#include <vector>

int main() {
    const std::vector<std::pair<std::string, bool>> cases = {
        {"a", true}, {"0", true}, {"demo.hello", true}, {"a._-z", true},
        {std::string(64, 'a'), true}, {std::string(65, 'a'), false},
        {"", false}, {".", false}, {"..", false}, {".a", false},
        {"a.", false}, {"a_", false}, {"a-", false}, {"Demo.hello", false},
        {"a/b", false}, {"a b", false}, {"a\xc3\xa9z", false},
        {"con", false}, {"con.txt", false}, {"prn", false}, {"aux.x", false},
        {"nul", false}, {"com1", false}, {"com9.ext", false}, {"lpt1", false},
        {"lpt9.ext", false}, {"com0", true}, {"com10", true}, {"lpt0", true},
        {"con-plugin", true}, {"aux_data", true}, {"x.con", true}
    };
    for (const auto& item : cases) {
        if (l4p::valid_id(item.first) != item.second) {
            std::cerr << "FAIL: ID contract for " << item.first << '\n';
            return 1;
        }
    }
    std::cout << "PASS: ID boundary contract (" << cases.size() << " cases, " << sizeof(void*) * 8 << "-bit)\n";
}
