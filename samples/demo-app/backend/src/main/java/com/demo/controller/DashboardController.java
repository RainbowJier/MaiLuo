package com.demo.controller;

import com.demo.service.DashboardService;
import com.demo.vo.OrderVO;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        return dashboardService.getOverview();
    }

    @GetMapping("/todo")
    public List<Map<String, Object>> todo() {
        return dashboardService.getTodoList();
    }

    @GetMapping("/recent-orders")
    public List<OrderVO> recentOrders(@RequestParam(defaultValue = "5") int limit) {
        return dashboardService.getRecentOrders(limit);
    }
}
