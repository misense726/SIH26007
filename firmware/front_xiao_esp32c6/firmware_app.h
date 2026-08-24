#pragma once

#include "node_config.h"

fogsen::XiaoSensorNode fogsen_front_node(fogsen_front::kNodeConfig);

void setup() {
  fogsen_front_node.begin();
}

void loop() {
  fogsen_front_node.update();
}
