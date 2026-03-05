"""
URL configuration for EVE_MDjango project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include("StarFieldSearch.urls")),
    path('api/', include("PlanetaryResource.urls")),
    path('api/', include("Bazaar.urls")),
    path('api/', include("FraudList.urls")),
    path('api/', include("TacticalBoard.urls")),
    path('api/user/', include("Authentication.urls")),
    path('api/activationcode/', include("ActivationCode.urls"))
]
