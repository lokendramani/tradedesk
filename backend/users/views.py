from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from .serializers import RegisterSerializer, LoginSerializer, get_tokens_for_user, UserSerializer

@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        return Response({
            'success': True,
            'message': 'Registration successful',
            'data': get_tokens_for_user(user)
        }, status=status.HTTP_201_CREATED)
    return Response({'success': False, 'message': serializer.errors}, status=400)

@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    serializer = LoginSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.validated_data['user']
        return Response({
            'success': True,
            'message': 'Login successful',
            'data': get_tokens_for_user(user)
        })
    return Response({'success': False, 'message': serializer.errors}, status=401)

@api_view(['POST'])
@permission_classes([AllowAny])
def refresh_token(request):
    try:
        refresh = RefreshToken(request.data.get('refresh'))
        return Response({'success': True, 'data': {'access': str(refresh.access_token)}})
    except Exception:
        return Response({'success': False, 'message': 'Invalid token'}, status=401)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    return Response({'success': True, 'data': UserSerializer(request.user).data})