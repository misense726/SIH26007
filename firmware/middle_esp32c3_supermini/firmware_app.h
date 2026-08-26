#pragma once

#include "node_config.h"

fogsen::MiddleFixedNode fogsen_middle_node(fogsen_middle::kNodeConfig);

void setup() {
  fogsen_middle_node.begin();
}

void loop() {
  fogsen_middle_node.update();
}
